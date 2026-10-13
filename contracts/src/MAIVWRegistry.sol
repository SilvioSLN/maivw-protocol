// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

// ============================================
//  Enums & Structs
// ============================================

enum DomainStatus {
    NONE,       // 0: Nunca registrado
    ACTIVE,     // 1: Operando normalmente
    SUSPENDED,  // 2: Suspenso por falta de saldo/caução (reativável via topUp)
    SLASHED,    // 3: Banido por fraude (só reativável via reclaim)
    REVOKED     // 4: Desativado administrativamente (ex.: mirror revogado)
}

enum ProviderTier {
    NONE,
    STARTUP,     // Tier 1
    GROWTH,      // Tier 2
    ENTERPRISE   // Tier 3
}

struct ProviderConfig {
    uint256 requiredStake;     // Caução exigida no registro do Tier (em wei)
    uint256 dailyLimit;        // Limite diário de mensagens
    uint256 penaltyPerStrike;  // Multa por infração validada
}

struct CompanyProfile {
    string domain;
    string endpointUrl;
    address publicKey;        // Chave de assinatura de mensagens (hot key)
    address adminKey;         // Chave de governança/administração do domínio (cold key)
    uint64 registrationTime;
    uint32 strikeCount;       // Contador de infrações (uint32 para evitar overflow em 255)
    uint32 epoch;             // Incrementa a cada troca de titularidade/reclaim
    bool isProvider;          // true = provedor multi-tenant
    DomainStatus status;      // Máquina de estados explícita
}

struct MirrorInfo {
    bool isMirror;
    uint256 originChainId;
    uint256 mirroredAt;
}

struct Recovery {
    address newAdminKey;
    address newPublicKey;
    uint64 executeAfter;
}

struct PendingSlash {
    uint64 executeAfter;
    bytes32 reportersHash;
}

struct InitConfig {
    address initialOwner;
    address guardian;
    address oracleNode;
    address payable founderWallet;
    address payable treasury;
    uint256 standardFee;
    uint256 providerFee;
    uint256 mirrorFee;
    uint256 slashDelay;       // Parametrizável: 0 em dev/testes locais, 48h em prod
    uint256 recoveryDelay;    // Parametrizável: 0 em dev/testes locais, 72h em prod
    ProviderConfig startup;
    ProviderConfig growth;
    ProviderConfig enterprise;
}

/// @title MAIVWRegistry v2 (UUPS Upgradeable)
/// @notice Cartório Público Descentralizado de Identidades de Domínio e Reputação de E-mail
/// @dev Implementa contabilidade rigorosa (solvência estrita), EIP-712 com nonces e prazos,
///      máquina de estados de domínio, governança two-step com timelocks parametrizáveis,
///      proteção contra reentrância e padrão UUPS (ERC-1967) para upgrades contínuos de governança.
contract MAIVWRegistry is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{

    // ============================================
    //  Constants
    // ============================================

    uint256 internal constant BPS_DENOMINATOR = 10000;
    uint256 internal constant FOUNDER_FEE_BPS = 1000;    // 10%
    uint256 internal constant TREASURY_FEE_BPS = 2500;   // 25%
    uint256 internal constant STAKE_BPS = 6500;          // 65%
    uint256 internal constant REPORTER_BOUNTY_BPS = 1000;// 10%
    uint256 internal constant BURN_BPS = 5500;           // 55%

    uint256 internal constant MAX_GENESIS_DOMAINS = 1000;
    uint256 public constant QUARANTINE_PERIOD = 30 days;
    uint256 public constant QUARANTINE_DAILY_VOLUME = 50;
    uint256 public constant NORMAL_DAILY_VOLUME = 10_000;

    uint256 internal constant MAX_REPORTERS = 50;
    uint256 internal constant MAX_ENDPOINT_LENGTH = 512;
    uint256 internal constant MAX_MESSAGE_CLASS_LENGTH = 32;
    uint256 internal constant MIN_STRIKES_TO_DRAIN = 10;

    address internal constant DEAD_ADDRESS = address(0x000000000000000000000000000000000000dEaD);

    // ============================================
    //  EIP-712 Typehashes
    // ============================================

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant HASHED_NAME = keccak256(bytes("MAIVWRegistry"));
    bytes32 private constant HASHED_VERSION = keccak256(bytes("2"));

    bytes32 public constant REGISTER_TYPEHASH = keccak256(
        "Register(bytes32 domainHash,address publicKey,address adminKey,address registrant,bool isProvider,uint8 tier,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant RECLAIM_TYPEHASH = keccak256(
        "Reclaim(bytes32 domainHash,address publicKey,address adminKey,address registrant,bool isProvider,uint8 tier,uint32 epoch,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant MIRROR_TYPEHASH = keccak256(
        "Mirror(bytes32 domainHash,address publicKey,address adminKey,address registrant,uint256 originChainId,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant RECOVERY_TYPEHASH = keccak256(
        "Recovery(bytes32 domainHash,address newAdminKey,address newPublicKey,uint32 epoch,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant INTENT_BATCH_TYPEHASH = keccak256(
        "IntentBatch(bytes32 domainHash,bytes32 messageClassHash,bytes32 merkleRoot,uint256 nonce,uint256 deadline)"
    );

    // ============================================
    //  State Variables: Profiles & Network
    // ============================================

    mapping(bytes32 => CompanyProfile) private profiles;
    mapping(bytes32 => MirrorInfo) public domainMirrors;
    bytes32[] private registeredDomainHashes;
    mapping(bytes32 => uint256) public domainNonces;
    mapping(bytes32 => address) internal pendingAdminKey;
    mapping(bytes32 => Recovery) internal pendingRecovery;
    mapping(bytes32 => PendingSlash) internal pendingSlashes;
    mapping(bytes32 => bool) internal frozen;

    // ============================================
    //  State Variables: Accounting & Solvency
    // ============================================

    mapping(bytes32 => uint256) public domainStakes;       // Única fonte contábil de caução por domínio
    uint256 public totalStaked;                            // Soma total de todos os domainStakes
    uint256 public accumulatedFounderFees;                 // Saldo acumulado a sacar pelo fundador
    uint256 public accumulatedTreasuryFees;                // Saldo acumulado a sacar pela tesouraria
    mapping(address => uint256) public pendingWithdrawals; // Saques pull de denunciantes, oráculo e reembolsos
    uint256 internal totalPendingWithdrawals;
    mapping(bytes32 => uint256) public domainTotalFees;    // Base de cálculo para percentuais de slashing

    // ============================================
    //  State Variables: Provider Tiers & Batches
    // ============================================

    mapping(bytes32 => ProviderTier) public providerTiers;
    mapping(ProviderTier => ProviderConfig) public tierConfigs;
    mapping(bytes32 => mapping(bytes32 => uint256)) internal providerSubIdentityStrikes;
    mapping(bytes32 => bytes32) internal batchRoots;

    // ============================================
    //  State Variables: Roles & Parameters
    // ============================================

    address public guardian;
    address public oracleNode;
    address payable public founderWallet;
    address payable public treasury;

    uint256 public standardFee;
    uint256 public providerFee;
    uint256 public mirrorFee;
    uint256 public genesisCount;

    uint256 internal slashDelay;
    uint256 internal recoveryDelay;

    // Tetos contra reajustes abusivos (definidos no initialize)
    uint256 internal maxStandardFee;
    uint256 internal maxProviderFee;
    uint256 internal maxMirrorFee;

    // ============================================
    //  Events
    // ============================================

    event CompanyRegistered(
        bytes32 indexed domainHash,
        string domain,
        address publicKey,
        address adminKey,
        bool isProvider,
        uint256 feePaid,
        uint256 timestamp
    );
    event ProviderRegistered(string domain, ProviderTier tier, uint256 stake);
    event DomainOwnershipChanged(
        bytes32 indexed domainHash,
        uint32 epoch,
        address indexed previousAdmin,
        address indexed newAdmin
    );
    event DomainStatusChanged(bytes32 indexed domainHash, DomainStatus fromStatus, DomainStatus toStatus);
    event DomainSlashed(string domain, address[] reporters, uint256 redistributed, uint256 burned);
    event DomainDeactivated(string domain, uint256 timestamp);
    event DomainReclaimed(string domain, address newPublicKey, address newAdminKey, uint32 epoch);
    event IntentBatchRegistered(string senderDomain, string messageClass, bytes32 merkleRoot, uint256 timestamp);
    event WarningTicketIssued(string providerDomain, string subIdentity, uint32 strikeCount);
    event PenaltyCharged(string providerDomain, uint256 penaltyCharged, uint256 remainingStake);
    event ResidualStakeReleased(bytes32 indexed domainHash, address indexed beneficiary, uint256 amount);
    event OracleNodeUpdated(address indexed newOracleNode);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);
    event FeesUpdated(uint256 newStandardFee, uint256 newProviderFee);
    event EndpointUpdated(string domain, string oldEndpoint, string newEndpoint);
    event PublicKeyUpdated(string domain, address oldPublicKey, address newPublicKey);
    event AdminKeyProposed(string domain, address indexed proposedAdmin);
    event AdminKeyUpdated(string domain, address indexed oldAdmin, address indexed newAdmin);
    event RecoveryRequested(string domain, address newAdminKey, address newPublicKey, uint256 executeAfter);
    event RecoveryCancelled(string domain);
    event RecoveryExecuted(string domain, address newAdminKey, address newPublicKey);
    event SlashProposed(string domain, address[] reporters, uint256 executeAfter);
    event SlashVetoed(string domain);
    event TierConfigUpdated(ProviderTier tier, uint256 requiredStake, uint256 dailyLimit, uint256 penaltyPerStrike);
    event FounderWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event FounderFeesWithdrawn(address indexed to, uint256 amount);
    event PendingWithdrawn(address indexed to, uint256 amount);
    event SurplusSwept(address indexed to, uint256 amount);
    event MirrorRegistered(
        bytes32 indexed domainHash,
        string domain,
        uint256 indexed originChainId,
        address publicKey,
        address adminKey,
        address registrant,
        uint256 feePaid
    );
    event MirrorDeactivated(string domain, uint256 timestamp);
    event MirrorFeeUpdated(uint256 oldFee, uint256 newFee);
    event BalanceToppedUp(string domain, uint256 amountAdded, uint256 newBalance);
    event ProviderReactivated(string domain, uint256 newBalance, uint256 timestamp);
    event ProviderSuspended(string domain, uint256 timestamp);
    event GenesisDomainRegistered(string domain, address publicKey, address adminKey, uint256 genesisIndex);
    event DelaysUpdated(uint256 newSlashDelay, uint256 newRecoveryDelay);
    event DomainTlsFingerprintUpdated(
        bytes32 indexed domainHash,
        string domain,
        bytes32 indexed fingerprint,
        uint256 timestamp
    );

    // ============================================
    //  Errors
    // ============================================

    error DomainAlreadyRegistered();
    error DomainStillActive();
    error DomainNotFound();
    error DomainNotActive();
    error DomainNotEligible();
    error IncorrectFee();
    error InvalidDomain();
    error InvalidEndpoint();
    error InvalidPublicKey();
    error InvalidAddress();
    error InvalidAmount();
    error InvalidConfig();
    error InvalidTier();
    error InvalidMerkleRoot();
    error BatchAlreadyRegistered();
    error OnlyOracleAllowed();
    error OnlyGuardianOrOwnerAllowed();
    error OnlyFounderAllowed();
    error UnauthorizedDomainCaller();
    error ProofExpired();
    error InvalidOracleProof();
    error TransferFailed();
    error NotAProvider();
    error NotAMirror();
    error InvalidMirrorOrigin();
    error GenesisExhausted();
    error TooManyReporters();
    error ReportersNotStrictlySorted();
    error ReportersMismatch();
    error SlashNotReady();
    error RecoveryNotReady();
    error FeeExceedsCap();
    error MirrorIsReadOnly();

    // ============================================
    //  Modifiers
    // ============================================

    modifier onlyOracle() {
        if (msg.sender != oracleNode) revert OnlyOracleAllowed();
        _;
    }

    modifier onlyDomainAdmin(bytes32 _h) {
        CompanyProfile storage p = profiles[_h];
        if (p.status != DomainStatus.ACTIVE) revert DomainNotActive();
        if (domainMirrors[_h].isMirror) revert MirrorIsReadOnly();
        if (msg.sender != p.adminKey) revert UnauthorizedDomainCaller();
        _;
    }

    // ============================================
    //  Constructor & Initializer (UUPS)
    // ============================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Inicializa as configurações da lógica através do Proxy ERC-1967
    function initialize(InitConfig memory c) external initializer {
        __Ownable_init(c.initialOwner);
        __Ownable2Step_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        if (
            c.initialOwner == address(0) ||
            c.guardian == address(0) ||
            c.oracleNode == address(0) ||
            c.founderWallet == address(0) ||
            c.treasury == address(0)
        ) revert InvalidAddress();

        if (c.standardFee == 0 || c.providerFee < c.standardFee) revert InvalidConfig();

        guardian = c.guardian;
        oracleNode = c.oracleNode;
        founderWallet = c.founderWallet;
        treasury = c.treasury;

        standardFee = c.standardFee;
        providerFee = c.providerFee;
        mirrorFee = c.mirrorFee;

        // Tetos definidos como 10x as taxas iniciais
        maxStandardFee = c.standardFee * 10;
        maxProviderFee = c.providerFee * 10;
        maxMirrorFee = c.mirrorFee > 0 ? c.mirrorFee * 10 : 1 ether;

        slashDelay = c.slashDelay;
        recoveryDelay = c.recoveryDelay;

        _setTier(ProviderTier.STARTUP, c.startup);
        _setTier(ProviderTier.GROWTH, c.growth);
        _setTier(ProviderTier.ENTERPRISE, c.enterprise);

        if (
            c.growth.requiredStake < c.startup.requiredStake ||
            c.enterprise.requiredStake < c.growth.requiredStake
        ) revert InvalidConfig();
    }

    /// @notice Autorização de upgrade do padrão UUPS — restrito ao Owner (Multi-sig)
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ============================================
    //  Solvency & Liabilities (Regra de Ouro)
    // ============================================

    function _totalLiabilities() internal view returns (uint256) {
        return totalStaked + accumulatedFounderFees + accumulatedTreasuryFees + totalPendingWithdrawals;
    }

    /// @notice Retorna a soma de todas as obrigações e custódias líquidas do contrato
    function totalLiabilities() external view returns (uint256) {
        return _totalLiabilities();
    }

    function _addStake(bytes32 _h, uint256 _amt) internal {
        domainStakes[_h] += _amt;
        totalStaked += _amt;
    }

    function _removeStake(bytes32 _h, uint256 _amt) internal {
        domainStakes[_h] -= _amt;
        totalStaked -= _amt;
    }

    function _credit(address _to, uint256 _amt) internal {
        pendingWithdrawals[_to] += _amt;
        totalPendingWithdrawals += _amt;
    }

    function _splitRegistrationFee(uint256 _value) internal returns (uint256 stake) {
        uint256 f = (_value * FOUNDER_FEE_BPS) / BPS_DENOMINATOR;
        uint256 t = (_value * TREASURY_FEE_BPS) / BPS_DENOMINATOR;
        accumulatedFounderFees += f;
        accumulatedTreasuryFees += t;
        stake = _value - f - t;
    }

    function _send(address _to, uint256 _amt) private {
        (bool ok, ) = payable(_to).call{value: _amt}("");
        if (!ok) revert TransferFailed();
    }

    // ============================================
    //  Withdrawals & Treasury (Bloco A)
    // ============================================

    /// @notice Saque da receita líquida da tesouraria pelo owner (Timelock/Safe)
    function withdrawTreasury(uint256 _amount) external onlyOwner nonReentrant {
        if (_amount == 0 || _amount > accumulatedTreasuryFees) revert InvalidAmount();
        accumulatedTreasuryFees -= _amount;
        _send(treasury, _amount);
        emit TreasuryWithdrawn(treasury, _amount);
    }

    /// @notice Saque da receita do fundador
    function withdrawFounderFees() external nonReentrant {
        if (msg.sender != founderWallet) revert OnlyFounderAllowed();
        uint256 amt = accumulatedFounderFees;
        if (amt == 0) revert InvalidAmount();
        accumulatedFounderFees = 0;
        _send(founderWallet, amt);
        emit FounderFeesWithdrawn(founderWallet, amt);
    }

    /// @notice Saque pull para recompensas de denunciantes, oráculos e devoluções. NUNCA pausável.
    function withdrawPending() external nonReentrant {
        uint256 amt = pendingWithdrawals[msg.sender];
        if (amt == 0) revert InvalidAmount();
        pendingWithdrawals[msg.sender] = 0;
        totalPendingWithdrawals -= amt;
        _send(msg.sender, amt);
        emit PendingWithdrawn(msg.sender, amt);
    }

    /// @notice Destina qualquer ETH forçado ou residual que exceda as obrigações à tesouraria
    function sweepSurplus() external {
        uint256 liabilities = _totalLiabilities();
        uint256 bal = address(this).balance;
        if (bal <= liabilities) revert InvalidAmount();
        uint256 surplus = bal - liabilities;
        accumulatedTreasuryFees += surplus;
        emit SurplusSwept(treasury, surplus);
    }

    // ============================================
    //  EIP-712 Signature Consumption (Bloco B)
    // ============================================

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                HASHED_NAME,
                HASHED_VERSION,
                block.chainid,
                address(this)
            )
        );
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparator();
    }

    function _hashTypedDataV4(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                _domainSeparator(),
                structHash
            )
        );
    }

    function _consumeOracleProof(
        bytes32 _domainHash,
        bytes32 _structHash,
        uint256 _deadline,
        bytes calldata _oracleProof
    ) internal {
        if (block.timestamp > _deadline) revert ProofExpired();
        domainNonces[_domainHash]++; // Invalida o nonce para evitar replay
        address signer = ECDSA.recover(_hashTypedDataV4(_structHash), _oracleProof);
        if (signer != oracleNode) revert InvalidOracleProof();
    }

    // ============================================
    //  Registration & Occupation (Blocos B & F)
    // ============================================

    /// @notice Registra uma empresa comum com prova criptográfica do oráculo
    function registerCompany(
        string calldata _domain,
        string calldata _endpoint,
        address _publicKey,
        address _adminKey,
        bool _isProvider,
        uint256 _deadline,
        bytes calldata _oracleProof
    ) external payable whenNotPaused {
        _validateCompanyRegistrationInputs(bytes(_domain), bytes(_endpoint), _publicKey, _adminKey, _isProvider);

        uint256 expectedFee = _isProvider ? providerFee : standardFee;
        if (msg.value != expectedFee) revert IncorrectFee();

        bytes32 h = _hash(_domain);
        {
            bytes32 structHash = keccak256(
                abi.encode(
                    REGISTER_TYPEHASH,
                    h,
                    _publicKey,
                    _adminKey,
                    msg.sender,
                    _isProvider,
                    uint8(ProviderTier.NONE),
                    domainNonces[h],
                    _deadline
                )
            );
            _consumeOracleProof(h, structHash, _deadline, _oracleProof);
        }

        uint256 stake = _splitRegistrationFee(msg.value);
        domainTotalFees[h] = msg.value;
        _addStake(h, stake);

        _registerNew(h, _domain);
        _setProfile(h, _endpoint, _publicKey, _adminKey, _isProvider);
        emit CompanyRegistered(h, _domain, _publicKey, _adminKey, _isProvider, msg.value, block.timestamp);
    }

    /// @notice Registra um provedor multi-tenant associando um Tier de tráfego
    function registerProvider(
        string calldata _domain,
        string calldata _endpoint,
        address _publicKey,
        address _adminKey,
        uint8 _tier,
        uint256 _deadline,
        bytes calldata _oracleProof
    ) external payable whenNotPaused {
        _validateRegistrationInputs(bytes(_domain), bytes(_endpoint), _publicKey, _adminKey);

        ProviderTier tier = ProviderTier(_tier);
        if (tier == ProviderTier.NONE) revert InvalidTier();
        ProviderConfig memory cfg = tierConfigs[tier];

        if (msg.value != cfg.requiredStake) revert IncorrectFee();

        bytes32 h = _hash(_domain);
        {
            bytes32 structHash = keccak256(
                abi.encode(
                    REGISTER_TYPEHASH,
                    h,
                    _publicKey,
                    _adminKey,
                    msg.sender,
                    true,
                    _tier,
                    domainNonces[h],
                    _deadline
                )
            );
            _consumeOracleProof(h, structHash, _deadline, _oracleProof);
        }

        _addStake(h, msg.value);
        providerTiers[h] = tier;
        domainTotalFees[h] = msg.value;

        _registerNew(h, _domain);
        _setProfile(h, _endpoint, _publicKey, _adminKey, true);
        emit CompanyRegistered(h, _domain, _publicKey, _adminKey, true, msg.value, block.timestamp);
        emit ProviderRegistered(_domain, tier, msg.value);
    }

    /// @notice Registra um espelho multi-chain de domínio já validado na rede de origem
    function registerMirror(
        string calldata _domain,
        string calldata _endpoint,
        address _publicKey,
        address _adminKey,
        uint256 _originChainId,
        uint256 _deadline,
        bytes calldata _oracleProof
    ) external payable whenNotPaused {
        _validateRegistrationInputs(bytes(_domain), bytes(_endpoint), _publicKey, _adminKey);

        if (msg.value != mirrorFee) revert IncorrectFee();
        if (_originChainId == block.chainid) revert InvalidMirrorOrigin();

        bytes32 h = _hash(_domain);
        {
            bytes32 structHash = keccak256(
                abi.encode(
                    MIRROR_TYPEHASH,
                    h,
                    _publicKey,
                    _adminKey,
                    msg.sender,
                    _originChainId,
                    domainNonces[h],
                    _deadline
                )
            );
            _consumeOracleProof(h, structHash, _deadline, _oracleProof);
        }

        _credit(oracleNode, msg.value); // Pull: oráculo saca via withdrawPending

        domainMirrors[h] = MirrorInfo({
            isMirror: true,
            originChainId: _originChainId,
            mirroredAt: block.timestamp
        });

        _registerNew(h, _domain);
        _setProfile(h, _endpoint, _publicKey, _adminKey, false);

        emit MirrorRegistered(h, _domain, _originChainId, _publicKey, _adminKey, msg.sender, msg.value);
    }

    /// @notice Reivindica um domínio inativo/banido comprovando posse do DNS perante o oráculo
    function reclaimDomain(
        string calldata _domain,
        string calldata _endpoint,
        address _publicKey,
        address _adminKey,
        bool _isProvider,
        uint8 _tier,
        uint256 _deadline,
        bytes calldata _oracleProof
    ) external payable whenNotPaused {
        _validateReclaimRegistrationInputs(
            bytes(_domain),
            bytes(_endpoint),
            _publicKey,
            _adminKey,
            _isProvider,
            _tier
        );

        bytes32 h = _hash(_domain);
        CompanyProfile storage p = profiles[h];
        if (p.status == DomainStatus.NONE) revert DomainNotFound();
        if (p.status == DomainStatus.ACTIVE) revert DomainStillActive();

        {
            uint256 expectedFee = standardFee;
            if (_isProvider) {
                ProviderTier tier = ProviderTier(_tier);
                expectedFee = (tier != ProviderTier.NONE) ? tierConfigs[tier].requiredStake : providerFee;
            }
            if (msg.value != expectedFee) revert IncorrectFee();
        }

        {
            bytes32 structHash = keccak256(
                abi.encode(
                    RECLAIM_TYPEHASH,
                    h,
                    _publicKey,
                    _adminKey,
                    msg.sender,
                    _isProvider,
                    _tier,
                    p.epoch,
                    domainNonces[h],
                    _deadline
                )
            );
            _consumeOracleProof(h, structHash, _deadline, _oracleProof);
        }

        _resetDomainState(h);

        if (_isProvider && ProviderTier(_tier) != ProviderTier.NONE) {
            _addStake(h, msg.value);
            providerTiers[h] = ProviderTier(_tier);
            domainTotalFees[h] = msg.value;
        } else {
            uint256 stake = _splitRegistrationFee(msg.value);
            domainTotalFees[h] = msg.value;
            _addStake(h, stake);
        }

        _setProfile(h, _endpoint, _publicKey, _adminKey, _isProvider);
        emit DomainReclaimed(_domain, _publicKey, _adminKey, p.epoch);
    }

    function _registerNew(bytes32 _h, string calldata _domain) internal {
        if (profiles[_h].status != DomainStatus.NONE) revert DomainAlreadyRegistered();
        registeredDomainHashes.push(_h);
        profiles[_h].domain = _domain;
    }

    function _setProfile(
        bytes32 _h,
        string calldata _endpoint,
        address _publicKey,
        address _adminKey,
        bool _isProvider
    ) internal {
        CompanyProfile storage p = profiles[_h];
        DomainStatus currentStatus = p.status;
        address prevAdmin = p.adminKey;

        p.endpointUrl = _endpoint;
        p.publicKey = _publicKey;
        p.adminKey = _adminKey;
        p.registrationTime = uint64(block.timestamp);
        p.isProvider = _isProvider;
        p.status = DomainStatus.ACTIVE;

        emit DomainStatusChanged(_h, currentStatus, DomainStatus.ACTIVE);
        emit DomainOwnershipChanged(_h, p.epoch, prevAdmin, _adminKey);
    }

    function _resetDomainState(bytes32 _h) internal {
        CompanyProfile storage p = profiles[_h];
        uint256 residual = domainStakes[_h];
        if (residual > 0) {
            _removeStake(_h, residual);
            address prev = p.adminKey;
            if (prev != address(0)) {
                _credit(prev, residual);
            } else {
                accumulatedTreasuryFees += residual;
            }
            emit ResidualStakeReleased(_h, prev, residual);
        }

        delete providerTiers[_h];
        delete domainMirrors[_h];
        delete domainTotalFees[_h];
        delete pendingAdminKey[_h];
        delete pendingRecovery[_h];
        delete pendingSlashes[_h];
        delete domainTlsFingerprints[_h];
        frozen[_h] = false;
        p.strikeCount = 0;
        p.epoch += 1;
    }

    // ============================================
    //  Provider TopUp & Suspension (Bloco C)
    // ============================================

    /// @notice Aumenta o saldo de caução do provedor; reativa se suspenso e cobrir o tier
    function topUpBalance(string calldata _domain) external payable whenNotPaused {
        if (msg.value == 0) revert InvalidAmount();
        bytes32 h = _hash(_domain);
        CompanyProfile storage p = profiles[h];
        if (!p.isProvider) revert NotAProvider();

        ProviderTier tier = providerTiers[h];
        if (tier == ProviderTier.NONE) revert InvalidTier();
        if (p.status != DomainStatus.ACTIVE && p.status != DomainStatus.SUSPENDED) {
            revert DomainNotEligible();
        }

        _addStake(h, msg.value);

        if (p.status == DomainStatus.SUSPENDED && domainStakes[h] >= tierConfigs[tier].requiredStake) {
            p.status = DomainStatus.ACTIVE;
            emit DomainStatusChanged(h, DomainStatus.SUSPENDED, DomainStatus.ACTIVE);
            emit ProviderReactivated(_domain, domainStakes[h], block.timestamp);
        }

        emit BalanceToppedUp(_domain, msg.value, domainStakes[h]);
    }

    /// @notice Aplica multa a provedor multi-tenant por spam/fraude originada em sub-identidade
    function issueWarningTicket(
        string calldata _providerDomain,
        string calldata _subIdentity
    ) external onlyOracle whenNotPaused {
        bytes32 h = _hash(_providerDomain);
        CompanyProfile storage p = profiles[h];
        if (p.status != DomainStatus.ACTIVE && p.status != DomainStatus.SUSPENDED) {
            revert DomainNotActive();
        }
        if (!p.isProvider) revert NotAProvider();

        p.strikeCount++;
        bytes32 subIdHash = keccak256(bytes(_subIdentity));
        providerSubIdentityStrikes[h][subIdHash]++;

        ProviderTier tier = providerTiers[h];
        uint256 penalty = tierConfigs[tier].penaltyPerStrike;
        uint256 currentStake = domainStakes[h];
        uint256 charged = penalty >= currentStake ? currentStake : penalty;

        if (charged > 0) {
            _removeStake(h, charged);
            accumulatedTreasuryFees += charged;
            emit PenaltyCharged(_providerDomain, charged, domainStakes[h]);
        }

        emit WarningTicketIssued(_providerDomain, _subIdentity, p.strikeCount);

        if (domainStakes[h] < tierConfigs[tier].requiredStake && p.status == DomainStatus.ACTIVE) {
            p.status = DomainStatus.SUSPENDED;
            emit DomainStatusChanged(h, DomainStatus.ACTIVE, DomainStatus.SUSPENDED);
            emit ProviderSuspended(_providerDomain, block.timestamp);
        }
    }

    // ============================================
    //  Slashing Governance (Blocos C & E)
    // ============================================

    /// @notice Propõe o slashing de um domínio infrator pelo oráculo com contestação
    function proposeSlash(string calldata _domain, address[] calldata _reporters) external onlyOracle whenNotPaused {
        _proposeSlashInternal(_hash(_domain), _domain, _reporters);
    }

    function _proposeSlashInternal(bytes32 h, string calldata _domain, address[] calldata _reporters) internal {
        CompanyProfile storage p = profiles[h];
        if (p.status != DomainStatus.ACTIVE && p.status != DomainStatus.SUSPENDED) {
            revert DomainNotActive();
        }
        if (_reporters.length > MAX_REPORTERS) revert TooManyReporters();

        pendingSlashes[h] = PendingSlash(
            uint64(block.timestamp + slashDelay),
            keccak256(abi.encode(_reporters))
        );
        frozen[h] = true;
        emit SlashProposed(_domain, _reporters, block.timestamp + slashDelay);
    }

    /// @notice Veta uma proposta de slashing indevida (Guardian ou Owner)
    function vetoSlash(string calldata _domain) external {
        if (msg.sender != guardian && msg.sender != owner()) revert OnlyGuardianOrOwnerAllowed();
        bytes32 h = _hash(_domain);
        delete pendingSlashes[h];
        frozen[h] = false;
        emit SlashVetoed(_domain);
    }

    /// @notice Executa o slashing após expirado o prazo de contestação (ou imediatamente se slashDelay == 0)
    function executeSlash(string calldata _domain, address[] calldata _reporters) external whenNotPaused {
        bytes32 h = _hash(_domain);
        PendingSlash memory ps = pendingSlashes[h];
        if (ps.executeAfter == 0 || block.timestamp < ps.executeAfter) revert SlashNotReady();
        if (keccak256(abi.encode(_reporters)) != ps.reportersHash) revert ReportersMismatch();

        delete pendingSlashes[h];
        frozen[h] = false;
        _slash(h, _domain, _reporters);
    }

    /// @notice Execução direta de slash (usado em setups onde slashDelay == 0 ou pelo oráculo)
    function slashDomain(string calldata _domain, address[] calldata _reporters) external onlyOracle whenNotPaused {
        bytes32 h = _hash(_domain);
        if (slashDelay > 0) {
            _proposeSlashInternal(h, _domain, _reporters);
            return;
        }
        _slash(h, _domain, _reporters);
    }

    function _slash(bytes32 _h, string calldata _domain, address[] calldata _reporters) internal {
        CompanyProfile storage p = profiles[_h];
        if (p.status != DomainStatus.ACTIVE && p.status != DomainStatus.SUSPENDED) {
            revert DomainNotActive();
        }
        uint256 n = _reporters.length;
        if (n > MAX_REPORTERS) revert TooManyReporters();

        DomainStatus prevStatus = p.status;
        p.status = DomainStatus.SLASHED;
        p.publicKey = address(0);
        domainNonces[_h]++;

        uint256 stake = domainStakes[_h];
        uint256 redistributed = 0;
        uint256 burnAmount = 0;

        if (stake > 0) {
            _removeStake(_h, stake);
            uint256 reporterShare = (domainTotalFees[_h] * REPORTER_BOUNTY_BPS) / BPS_DENOMINATOR;
            if (reporterShare > stake) {
                reporterShare = stake;
            }

            if (n > 0 && reporterShare > 0) {
                uint256 per = reporterShare / n;
                address prev = address(0);
                for (uint256 i = 0; i < n; ++i) {
                    address r = _reporters[i];
                    if (r <= prev) revert ReportersNotStrictlySorted();
                    prev = r;
                    _credit(r, per);
                }
                redistributed = per * n;
            }

            burnAmount = stake - redistributed;
        }

        emit DomainStatusChanged(_h, prevStatus, DomainStatus.SLASHED);
        emit DomainSlashed(_domain, _reporters, redistributed, burnAmount);
        emit DomainDeactivated(_domain, block.timestamp);

        if (burnAmount > 0) {
            _send(DEAD_ADDRESS, burnAmount);
        }
    }

    // ============================================
    //  Account Recovery & Keys (Bloco E)
    // ============================================

    /// @notice Atualiza a chave hot de assinatura; somente a chave admin cold da origem pode rotacioná-la.
    function updatePublicKey(string calldata _domain, address _newPublicKey) external {
        _validateKey(_newPublicKey);
        bytes32 h = _hash(_domain);
        CompanyProfile storage p = profiles[h];
        if (p.status != DomainStatus.ACTIVE) revert DomainNotActive();
        if (domainMirrors[h].isMirror) revert MirrorIsReadOnly();
        if (msg.sender != p.adminKey) revert UnauthorizedDomainCaller();

        address old = p.publicKey;
        p.publicKey = _newPublicKey;
        emit PublicKeyUpdated(_domain, old, _newPublicKey);
    }

    /// @notice Atualiza o endpoint de recebimento; somente a chave admin cold da origem.
    function updateEndpoint(string calldata _domain, string calldata _newEndpoint) external {
        _validateEndpoint(bytes(_newEndpoint));
        bytes32 h = _hash(_domain);
        CompanyProfile storage p = profiles[h];
        if (p.status != DomainStatus.ACTIVE) revert DomainNotActive();
        if (domainMirrors[h].isMirror) revert MirrorIsReadOnly();
        if (msg.sender != p.adminKey) revert UnauthorizedDomainCaller();

        string memory old = p.endpointUrl;
        p.endpointUrl = _newEndpoint;
        emit EndpointUpdated(_domain, old, _newEndpoint);
    }

    /// @notice Registra ou atualiza o fingerprint SHA-256 do certificado TLS do domínio (DANE On-Chain / S08)
    function setDomainTlsFingerprint(string calldata _domain, bytes32 _fingerprint) external {
        bytes32 h = _hash(_domain);
        CompanyProfile storage p = profiles[h];
        if (p.status != DomainStatus.ACTIVE) revert DomainNotActive();
        if (domainMirrors[h].isMirror) revert MirrorIsReadOnly();
        if (msg.sender != p.adminKey) revert UnauthorizedDomainCaller();

        domainTlsFingerprints[h] = _fingerprint;
        emit DomainTlsFingerprintUpdated(h, _domain, _fingerprint, block.timestamp);
    }

    /// @notice Consulta o fingerprint SHA-256 do certificado TLS do domínio (DANE On-Chain / S08)
    function getDomainTlsFingerprint(string calldata _domain) external view returns (bytes32) {
        return domainTlsFingerprints[_hash(_domain)];
    }

    /// @notice Proposta de novo adminKey (two-step rotation)
    function proposeAdminKey(string calldata _domain, address _newAdmin) external onlyDomainAdmin(_hash(_domain)) {
        _validateKey(_newAdmin);
        bytes32 h = _hash(_domain);
        pendingAdminKey[h] = _newAdmin;
        emit AdminKeyProposed(_domain, _newAdmin);
    }

    /// @notice Aceite da administração da chave cold
    function acceptAdminKey(string calldata _domain) external {
        bytes32 h = _hash(_domain);
        CompanyProfile storage p = profiles[h];
        if (p.status != DomainStatus.ACTIVE) revert DomainNotActive();
        if (domainMirrors[h].isMirror) revert MirrorIsReadOnly();
        if (msg.sender != pendingAdminKey[h]) revert UnauthorizedDomainCaller();
        address old = p.adminKey;
        p.adminKey = msg.sender;
        delete pendingAdminKey[h];
        emit AdminKeyUpdated(_domain, old, msg.sender);
    }

    /// @notice Inicia o processo de recuperação de controle de chave com timelock e validação do oráculo
    function requestRecovery(
        string calldata _domain,
        address _newAdminKey,
        address _newPublicKey,
        uint256 _deadline,
        bytes calldata _oracleProof
    ) external whenNotPaused {
        bytes32 h = _hash(_domain);
        CompanyProfile storage p = profiles[h];
        if (p.status != DomainStatus.ACTIVE) revert DomainNotActive();
        if (domainMirrors[h].isMirror) revert MirrorIsReadOnly();
        _validateKey(_newAdminKey);
        _validateKey(_newPublicKey);

        bytes32 sh = keccak256(
            abi.encode(
                RECOVERY_TYPEHASH,
                h,
                _newAdminKey,
                _newPublicKey,
                p.epoch,
                domainNonces[h],
                _deadline
            )
        );
        _consumeOracleProof(h, sh, _deadline, _oracleProof);

        pendingRecovery[h] = Recovery(
            _newAdminKey,
            _newPublicKey,
            uint64(block.timestamp + recoveryDelay)
        );

        emit RecoveryRequested(_domain, _newAdminKey, _newPublicKey, block.timestamp + recoveryDelay);
    }

    /// @notice Cancela uma solicitação indevida de recuperação (o admin atual pode abortar a qualquer momento)
    function cancelRecovery(string calldata _domain) external onlyDomainAdmin(_hash(_domain)) {
        bytes32 h = _hash(_domain);
        delete pendingRecovery[h];
        emit RecoveryCancelled(_domain);
    }

    /// @notice Executa a recuperação após decorrido o recoveryDelay
    function executeRecovery(string calldata _domain) external {
        bytes32 h = _hash(_domain);
        Recovery memory r = pendingRecovery[h];
        if (r.executeAfter == 0 || block.timestamp < r.executeAfter) revert RecoveryNotReady();

        delete pendingRecovery[h];
        CompanyProfile storage p = profiles[h];
        if (domainMirrors[h].isMirror) revert MirrorIsReadOnly();
        delete pendingAdminKey[h];
        p.adminKey = r.newAdminKey;
        p.publicKey = r.newPublicKey;
        p.epoch += 1;
        domainNonces[h]++;

        emit RecoveryExecuted(_domain, r.newAdminKey, r.newPublicKey);
    }

    // ============================================
    //  Batches & Mirrors (Blocos F)
    // ============================================

    /// @notice Registra raiz Merkle de intenções de e-mail por domínio
    function registerIntentBatch(
        string calldata _senderDomain,
        string calldata _messageClass,
        bytes32 _merkleRoot
    ) external whenNotPaused {
        bytes32 h = _hash(_senderDomain);
        CompanyProfile storage p = profiles[h];
        if (p.status != DomainStatus.ACTIVE) revert DomainNotActive();
        if (domainMirrors[h].isMirror) revert MirrorIsReadOnly();
        if (msg.sender != p.publicKey && msg.sender != p.adminKey && msg.sender != oracleNode) {
            revert UnauthorizedDomainCaller();
        }
        if (_merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (bytes(_messageClass).length > MAX_MESSAGE_CLASS_LENGTH) revert InvalidConfig();

        bytes32 batchKey = keccak256(
            abi.encode(h, keccak256(bytes(_messageClass)), _merkleRoot, block.timestamp)
        );
        if (batchRoots[batchKey] != bytes32(0)) revert BatchAlreadyRegistered();

        batchRoots[batchKey] = _merkleRoot;
        emit IntentBatchRegistered(_senderDomain, _messageClass, _merkleRoot, block.timestamp);
    }

    /// @notice Desativa um espelho multi-chain (apenas para mirrors)
    function deactivateMirror(string calldata _domain) external whenNotPaused {
        if (msg.sender != oracleNode && msg.sender != owner()) revert OnlyOracleAllowed();
        bytes32 h = _hash(_domain);
        CompanyProfile storage p = profiles[h];
        if (!domainMirrors[h].isMirror) revert NotAMirror();
        if (p.status != DomainStatus.ACTIVE) revert DomainNotActive();

        p.status = DomainStatus.REVOKED;
        domainMirrors[h].isMirror = false;
        domainNonces[h]++;

        emit DomainStatusChanged(h, DomainStatus.ACTIVE, DomainStatus.REVOKED);
        emit MirrorDeactivated(_domain, block.timestamp);
    }

    // ============================================
    //  Genesis Quota (Fundador)
    // ============================================

    /// @notice Registra um domínio gratuito sob a Cota Gênesis subsidiada
    function registerGenesisDomain(
        string calldata _domain,
        string calldata _endpoint,
        address _publicKey
    ) external onlyOwner whenNotPaused {
        if (genesisCount >= MAX_GENESIS_DOMAINS) revert GenesisExhausted();
        _validateRegistrationInputs(bytes(_domain), bytes(_endpoint), _publicKey, msg.sender);

        bytes32 h = _hash(_domain);
        genesisCount++;

        _registerNew(h, _domain);
        _setProfile(h, _endpoint, _publicKey, msg.sender, false);
        emit GenesisDomainRegistered(_domain, _publicKey, msg.sender, genesisCount);
    }

    /// @notice Registra um provedor multi-tenant sob a Cota Gênesis
    function registerGenesisProvider(
        string calldata _domain,
        string calldata _endpoint,
        address _publicKey,
        ProviderTier _tier
    ) external payable onlyOwner whenNotPaused {
        if (genesisCount >= MAX_GENESIS_DOMAINS) revert GenesisExhausted();
        if (_tier == ProviderTier.NONE) revert InvalidTier();
        _validateRegistrationInputs(bytes(_domain), bytes(_endpoint), _publicKey, msg.sender);
        if (msg.value != tierConfigs[_tier].requiredStake) revert IncorrectFee();

        bytes32 h = _hash(_domain);
        genesisCount++;

        _addStake(h, msg.value);
        domainTotalFees[h] = msg.value;

        providerTiers[h] = _tier;
        _registerNew(h, _domain);
        _setProfile(h, _endpoint, _publicKey, msg.sender, true);

        emit GenesisDomainRegistered(_domain, _publicKey, msg.sender, genesisCount);
        emit ProviderRegistered(_domain, _tier, msg.value);
    }

    // ============================================
    //  Governance & Configuration (Bloco D & E)
    // ============================================

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert OnlyGuardianOrOwnerAllowed();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setGuardian(address _newGuardian) external onlyOwner {
        if (_newGuardian == address(0)) revert InvalidAddress();
        address old = guardian;
        guardian = _newGuardian;
        emit GuardianUpdated(old, _newGuardian);
    }

    function setOracleNode(address _newOracle) external onlyOwner {
        if (_newOracle == address(0)) revert InvalidAddress();
        oracleNode = _newOracle;
        emit OracleNodeUpdated(_newOracle);
    }

    function setFounderWallet(address payable _newWallet) external onlyOwner {
        if (_newWallet == address(0)) revert InvalidAddress();
        address old = founderWallet;
        founderWallet = _newWallet;
        emit FounderWalletUpdated(old, _newWallet);
    }

    function setTreasury(address payable _newTreasury) external onlyOwner {
        if (_newTreasury == address(0)) revert InvalidAddress();
        address old = treasury;
        treasury = _newTreasury;
        emit TreasuryUpdated(old, _newTreasury);
    }

    function setFees(uint256 _newStandardFee, uint256 _newProviderFee) external onlyOwner {
        if (_newStandardFee > maxStandardFee || _newProviderFee > maxProviderFee) revert FeeExceedsCap();
        if (_newStandardFee == 0 || _newProviderFee < _newStandardFee) revert InvalidConfig();
        standardFee = _newStandardFee;
        providerFee = _newProviderFee;
        emit FeesUpdated(_newStandardFee, _newProviderFee);
    }

    function setMirrorFee(uint256 _newFee) external onlyOwner {
        if (_newFee > maxMirrorFee) revert FeeExceedsCap();
        uint256 old = mirrorFee;
        mirrorFee = _newFee;
        emit MirrorFeeUpdated(old, _newFee);
    }

    function setTierConfig(
        ProviderTier _tier,
        uint256 _requiredStake,
        uint256 _dailyLimit,
        uint256 _penaltyPerStrike
    ) external onlyOwner {
        if (_tier == ProviderTier.NONE) revert InvalidTier();
        _setTier(_tier, ProviderConfig(_requiredStake, _dailyLimit, _penaltyPerStrike));
    }

    function _setTier(ProviderTier _t, ProviderConfig memory _cfg) internal {
        if (_cfg.requiredStake == 0 || _cfg.dailyLimit == 0) revert InvalidConfig();
        if (
            _cfg.penaltyPerStrike == 0 ||
            _cfg.penaltyPerStrike * MIN_STRIKES_TO_DRAIN > _cfg.requiredStake
        ) revert InvalidConfig();
        tierConfigs[_t] = _cfg;
        emit TierConfigUpdated(_t, _cfg.requiredStake, _cfg.dailyLimit, _cfg.penaltyPerStrike);
    }

    function setDelays(uint256 _newSlashDelay, uint256 _newRecoveryDelay) external onlyOwner {
        slashDelay = _newSlashDelay;
        recoveryDelay = _newRecoveryDelay;
        emit DelaysUpdated(_newSlashDelay, _newRecoveryDelay);
    }

    // ============================================
    //  Views & Compatibility
    // ============================================

    function isDomainActive(string calldata _domain) external view returns (bool) {
        bytes32 h = _hash(_domain);
        if (frozen[h]) return false;
        return profiles[h].status == DomainStatus.ACTIVE;
    }

    function getCompanyProfile(string calldata _domain) external view returns (CompanyProfile memory) {
        return profiles[_hash(_domain)];
    }

    function getCompanyProfileByHash(bytes32 _h) external view returns (CompanyProfile memory) {
        return profiles[_h];
    }

    function getPublicKey(string calldata _domain) external view returns (address) {
        CompanyProfile storage p = profiles[_hash(_domain)];
        if (p.status != DomainStatus.ACTIVE || p.publicKey == address(0)) {
            revert DomainNotFound();
        }
        return p.publicKey;
    }

    function getEndpointUrl(string calldata _domain) external view returns (string memory) {
        CompanyProfile storage p = profiles[_hash(_domain)];
        if (p.status != DomainStatus.ACTIVE) revert DomainNotFound();
        return p.endpointUrl;
    }

    function _dailyVolume(bytes32 _h) internal view returns (uint256) {
        CompanyProfile storage p = profiles[_h];
        if (p.status != DomainStatus.ACTIVE) return 0;
        if (p.isProvider) {
            ProviderTier tier = providerTiers[_h];
            return tierConfigs[tier].dailyLimit;
        }
        if (block.timestamp - p.registrationTime < QUARANTINE_PERIOD) {
            return QUARANTINE_DAILY_VOLUME;
        }
        return NORMAL_DAILY_VOLUME;
    }

    function getAllowedDailyVolume(string calldata _domain) external view returns (uint256) {
        return _dailyVolume(_hash(_domain));
    }
    function getProviderInfo(string calldata _domain) external view returns (
        bool isProvider,
        ProviderTier tier,
        uint256 dailyLimit,
        uint256 stakeBalance,
        uint32 strikeCount,
        bool isSuspended
    ) {
        bytes32 h = _hash(_domain);
        CompanyProfile storage p = profiles[h];
        isProvider = p.isProvider;
        tier = providerTiers[h];
        dailyLimit = tierConfigs[tier].dailyLimit;
        stakeBalance = domainStakes[h];
        strikeCount = p.strikeCount;
        isSuspended = (p.status == DomainStatus.SUSPENDED);
    }

    function isDomainProvider(string calldata _d) external view returns (bool) {
        return profiles[_hash(_d)].isProvider;
    }

    function getGenesisStatus() external view returns (uint256 currentCount, uint256 maxCount) {
        return (genesisCount, MAX_GENESIS_DOMAINS);
    }

    function getMirrorInfo(string calldata _domain) external view returns (bool isMirror, uint256 originChain, uint256 mirroredAt) {
        MirrorInfo memory m = domainMirrors[_hash(_domain)];
        return (m.isMirror, m.originChainId, m.mirroredAt);
    }

    function getRegisteredDomainCount() external view returns (uint256) {
        return registeredDomainHashes.length;
    }

    function getDomainHashByIndex(uint256 _index) external view returns (bytes32) {
        return registeredDomainHashes[_index];
    }

    // ============================================
    //  Internal Validations
    // ============================================

    function _hash(string calldata _d) internal pure returns (bytes32) {
        return keccak256(bytes(_d));
    }

    function _validateKey(address _key) internal pure {
        if (_key == address(0)) revert InvalidPublicKey();
    }

    function _validateEndpoint(bytes calldata _e) internal pure {
        if (_e.length == 0 || _e.length > MAX_ENDPOINT_LENGTH) revert InvalidEndpoint();
    }

    function _validateRegistrationInputs(
        bytes calldata _d,
        bytes calldata _e,
        address _pubKey,
        address _admKey
    ) internal pure {
        _validateDomain(_d);
        _validateEndpoint(_e);
        _validateKey(_pubKey);
        _validateKey(_admKey);
    }

    function _validateCompanyRegistrationInputs(
        bytes calldata _d,
        bytes calldata _e,
        address _pubKey,
        address _admKey,
        bool _isProvider
    ) internal pure {
        _validateRegistrationInputs(_d, _e, _pubKey, _admKey);
        if (_isProvider) revert InvalidTier();
    }

    function _validateReclaimRegistrationInputs(
        bytes calldata _d,
        bytes calldata _e,
        address _pubKey,
        address _admKey,
        bool _isProvider,
        uint8 _tier
    ) internal pure {
        _validateRegistrationInputs(_d, _e, _pubKey, _admKey);
        if (_isProvider) {
            if (_tier < uint8(ProviderTier.STARTUP) || _tier > uint8(ProviderTier.ENTERPRISE)) {
                revert InvalidTier();
            }
        } else if (_tier != uint8(ProviderTier.NONE)) {
            revert InvalidTier();
        }
    }

    bytes1 private constant DOT = 0x2e;
    bytes1 private constant HYPHEN = 0x2d;
    bytes1 private constant LOWER_A = 0x61;
    bytes1 private constant LOWER_Z = 0x7a;
    bytes1 private constant DIGIT_0 = 0x30;
    bytes1 private constant DIGIT_9 = 0x39;

    function _validateDomain(bytes calldata _d) internal pure {
        uint256 len = _d.length;
        if (len == 0 || len > 253) revert InvalidDomain();
        bytes1 prev = DOT;
        uint256 labelLen;
        bool hasDot;

        for (uint256 i; i < len; ++i) {
            bytes1 c = _d[i];
            if (c == DOT) {
                if (prev == DOT || prev == HYPHEN) revert InvalidDomain();
                hasDot = true;
                labelLen = 0;
            } else {
                if (c == HYPHEN) {
                    if (prev == DOT) revert InvalidDomain();
                } else if ((c < LOWER_A || c > LOWER_Z) && (c < DIGIT_0 || c > DIGIT_9)) {
                    revert InvalidDomain();
                }
                if (++labelLen > 63) revert InvalidDomain();
            }
            prev = c;
        }

        if (!hasDot || prev == DOT || prev == HYPHEN) revert InvalidDomain();
    }

    // ============================================
    //  State Variables: DANE / mTLS On-Chain (S08)
    // ============================================
    mapping(bytes32 => bytes32) public domainTlsFingerprints;

    // ============================================
    //  Storage Gap (Reserva para versões futuras)
    // ============================================
    uint256[49] private __gap;
}
