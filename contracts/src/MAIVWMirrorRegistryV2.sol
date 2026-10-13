// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {DomainStatus, ProviderTier, CompanyProfile} from "./MAIVWRegistry.sol";
import {MAIVWAttestationV1} from "./libraries/MAIVWAttestationV1.sol";

enum KeyAlgorithm {
    NONE,
    SECP256K1_EVM_ADDRESS,
    ED25519_SOLANA_PUBKEY,
    ED25519_RAW
}

struct KeyDescriptor {
    KeyAlgorithm algorithm;
    bytes32 keyData;
}

struct MirrorStateV2 {
    KeyDescriptor publicKey;
    KeyDescriptor adminKey;
    string endpointUrl;
    bytes32 tlsFingerprint;
    DomainStatus status;
    bool isProvider;
    ProviderTier tier;
    uint32 strikeCount;
    uint64 registrationTime;
    uint256 attestedStake;
    uint256 dailyLimit;
}

struct MirrorProfileV2 {
    string domain;
    string endpointUrl;
    KeyDescriptor publicKey;
    KeyDescriptor adminKey;
    bytes32 tlsFingerprint;
    DomainStatus status;
    bool isProvider;
    ProviderTier tier;
    uint32 strikeCount;
    uint64 registrationTime;
}

struct MirrorVersionV2 {
    bytes32 originNetworkHash;
    bytes32 originRegistry;
    uint64 globalDomainEpoch;
    uint64 originSequence;
    bytes32 originTxReference;
    bytes32 lastPayloadHash;
    uint256 attestedStake;
    uint256 dailyLimit;
    uint64 updatedAt;
    bool revoked;
    bool exists;
}

interface IMAIVWLegacyRegistry {
    function getCompanyProfile(string calldata domain) external view returns (CompanyProfile memory);
    function getMirrorInfo(string calldata domain) external view returns (bool, uint256, uint256);
    function getDomainTlsFingerprint(string calldata domain) external view returns (bytes32);
    function getAllowedDailyVolume(string calldata domain) external view returns (uint256);
    function domainStakes(bytes32 domainHash) external view returns (uint256);
    function providerTiers(bytes32 domainHash) external view returns (ProviderTier);
}

/// @title MAIVW Mirror Registry V2
/// @notice Registry EVM dedicado a projeções multichain. Mantém chaves Solana sem inventar aliases `address`.
/// @dev É separado do Registry canônico porque a implementação legada já está no limite EIP-170.
contract MAIVWMirrorRegistryV2 is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    uint256 private constant MAX_ENDPOINT_LENGTH = 512;
    uint8 private constant KIND_STATE_ATTESTATION = 2;
    uint8 private constant ACTION_REGISTER_MIRROR = 2;
    uint8 private constant ACTION_SYNC_MIRROR = 3;
    uint8 private constant ACTION_REVOKE_MIRROR = 4;
    bytes1 private constant DOT = 0x2e;
    bytes1 private constant HYPHEN = 0x2d;

    bytes32 public constant MIRROR_STATE_V2_TYPEHASH = keccak256(
        "MirrorStateV2(uint8 publicKeyAlgorithm,bytes32 publicKeyData,uint8 adminKeyAlgorithm,bytes32 adminKeyData,bytes32 endpointHash,bytes32 tlsFingerprint,uint8 status,bool isProvider,uint8 tier,uint32 strikeCount,uint64 registrationTime,uint256 attestedStake,uint256 dailyLimit)"
    );

    address public guardian;
    address public oracleNode;
    address public legacyRegistry;

    mapping(bytes32 => MirrorProfileV2) private mirrorProfiles;
    mapping(bytes32 => MirrorVersionV2) private mirrorVersions;

    event MirrorV2Registered(
        bytes32 indexed domainHash,
        bytes32 indexed originNetworkHash,
        bytes32 indexed originRegistry,
        uint64 globalDomainEpoch,
        uint64 originSequence,
        bytes32 originTxReference
    );
    event MirrorV2Synchronized(
        bytes32 indexed domainHash,
        uint64 globalDomainEpoch,
        uint64 originSequence,
        DomainStatus status,
        bytes32 originTxReference
    );
    event MirrorV2Revoked(
        bytes32 indexed domainHash,
        uint64 globalDomainEpoch,
        uint64 originSequence,
        bytes32 originTxReference
    );
    event LegacyMirrorMigrated(
        bytes32 indexed domainHash,
        bytes32 indexed originNetworkHash,
        bytes32 indexed originRegistry,
        uint64 globalDomainEpoch,
        uint64 originSequence
    );
    event OracleNodeUpdated(address indexed previousOracle, address indexed newOracle);
    event GuardianUpdated(address indexed previousGuardian, address indexed newGuardian);

    error InvalidAddress();
    error InvalidDomain();
    error InvalidKeyDescriptor();
    error InvalidMirrorState();
    error InvalidMirrorOrigin();
    error InvalidAttestationDestination();
    error InvalidAttestationPayload();
    error InvalidOracleProof();
    error MirrorNotFound();
    error MirrorAlreadyRegistered();
    error MirrorOriginMismatch();
    error MirrorVersionRegression();
    error MirrorVersionConflict();
    error MirrorAlreadyMigrated();
    error OnlyGuardianOrOwnerAllowed();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _initialOwner,
        address _guardian,
        address _oracleNode,
        address _legacyRegistry
    ) external initializer {
        if (
            _initialOwner == address(0) ||
            _guardian == address(0) ||
            _oracleNode == address(0) ||
            _legacyRegistry == address(0)
        ) revert InvalidAddress();
        __Ownable_init(_initialOwner);
        __Ownable2Step_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        guardian = _guardian;
        oracleNode = _oracleNode;
        legacyRegistry = _legacyRegistry;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    function registerMirrorV2(
        string calldata _domain,
        MirrorStateV2 calldata _state,
        MAIVWAttestationV1.Attestation calldata _attestation,
        bytes calldata _oracleSignature
    ) external whenNotPaused returns (bool applied) {
        bytes32 h = _validate(_domain, _state, _attestation, ACTION_REGISTER_MIRROR, _oracleSignature);
        MirrorVersionV2 storage version = mirrorVersions[h];
        if (version.exists) {
            _validateSameOrigin(version, _attestation);
            if (_acceptVersion(version, _attestation)) revert MirrorAlreadyRegistered();
            return false;
        }
        if (_state.status == DomainStatus.REVOKED) revert InvalidMirrorState();
        _write(h, _domain, _state, _attestation, false);
        emit MirrorV2Registered(
            h,
            _attestation.originNetworkHash,
            _attestation.originRegistry,
            _attestation.globalDomainEpoch,
            _attestation.originSequence,
            _attestation.evidenceHash
        );
        return true;
    }

    function syncMirrorV2(
        string calldata _domain,
        MirrorStateV2 calldata _state,
        MAIVWAttestationV1.Attestation calldata _attestation,
        bytes calldata _oracleSignature
    ) external whenNotPaused returns (bool applied) {
        bytes32 h = _validate(_domain, _state, _attestation, ACTION_SYNC_MIRROR, _oracleSignature);
        MirrorVersionV2 storage version = mirrorVersions[h];
        if (!version.exists) revert MirrorNotFound();
        _validateSameOrigin(version, _attestation);
        if (!_acceptVersion(version, _attestation)) return false;
        if (_state.status == DomainStatus.REVOKED) revert InvalidMirrorState();
        _write(h, _domain, _state, _attestation, false);
        emit MirrorV2Synchronized(
            h,
            _attestation.globalDomainEpoch,
            _attestation.originSequence,
            _state.status,
            _attestation.evidenceHash
        );
        return true;
    }

    function revokeMirrorV2(
        string calldata _domain,
        MirrorStateV2 calldata _state,
        MAIVWAttestationV1.Attestation calldata _attestation,
        bytes calldata _oracleSignature
    ) external whenNotPaused returns (bool applied) {
        bytes32 h = _validate(_domain, _state, _attestation, ACTION_REVOKE_MIRROR, _oracleSignature);
        if (_state.status != DomainStatus.REVOKED) revert InvalidMirrorState();
        MirrorVersionV2 storage version = mirrorVersions[h];
        if (!version.exists) revert MirrorNotFound();
        _validateSameOrigin(version, _attestation);
        if (!_acceptVersion(version, _attestation)) return false;
        _write(h, _domain, _state, _attestation, true);
        emit MirrorV2Revoked(
            h,
            _attestation.globalDomainEpoch,
            _attestation.originSequence,
            _attestation.evidenceHash
        );
        return true;
    }

    /// @notice Importa uma projeção legada uma única vez. A origem permanece imutável após a migração.
    function migrateLegacyMirrorV2(
        string calldata _domain,
        bytes32 _originRegistry,
        uint64 _originSequence,
        bytes32 _originTxReference
    ) external onlyOwner {
        bytes32 h = keccak256(bytes(_domain));
        if (mirrorVersions[h].exists) revert MirrorAlreadyMigrated();
        IMAIVWLegacyRegistry legacy = IMAIVWLegacyRegistry(legacyRegistry);
        (bool isMirror, uint256 originChainId, ) = legacy.getMirrorInfo(_domain);
        if (
            !isMirror ||
            originChainId == 0 ||
            _originRegistry == bytes32(0) ||
            _originTxReference == bytes32(0)
        ) revert InvalidMirrorOrigin();
        CompanyProfile memory old = legacy.getCompanyProfile(_domain);

        MirrorStateV2 memory state = MirrorStateV2({
            publicKey: _evmDescriptor(old.publicKey),
            adminKey: _evmDescriptor(old.adminKey),
            endpointUrl: old.endpointUrl,
            tlsFingerprint: legacy.getDomainTlsFingerprint(_domain),
            status: old.status,
            isProvider: old.isProvider,
            tier: legacy.providerTiers(h),
            strikeCount: old.strikeCount,
            registrationTime: old.registrationTime,
            attestedStake: legacy.domainStakes(h),
            dailyLimit: legacy.getAllowedDailyVolume(_domain)
        });
        bytes32 originNetworkHash = keccak256(bytes(string.concat("evm:", Strings.toString(originChainId))));
        mirrorProfiles[h] = _profile(_domain, state);
        mirrorVersions[h] = MirrorVersionV2({
            originNetworkHash: originNetworkHash,
            originRegistry: _originRegistry,
            globalDomainEpoch: old.epoch,
            originSequence: _originSequence,
            originTxReference: _originTxReference,
            lastPayloadHash: hashMirrorStateV2(state),
            attestedStake: state.attestedStake,
            dailyLimit: state.dailyLimit,
            updatedAt: uint64(block.timestamp),
            revoked: old.status == DomainStatus.REVOKED,
            exists: true
        });
        emit LegacyMirrorMigrated(h, originNetworkHash, _originRegistry, old.epoch, _originSequence);
    }

    function hashMirrorStateV2(MirrorStateV2 memory _state) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                MIRROR_STATE_V2_TYPEHASH,
                _state.publicKey.algorithm,
                _state.publicKey.keyData,
                _state.adminKey.algorithm,
                _state.adminKey.keyData,
                keccak256(bytes(_state.endpointUrl)),
                _state.tlsFingerprint,
                _state.status,
                _state.isProvider,
                _state.tier,
                _state.strikeCount,
                _state.registrationTime,
                _state.attestedStake,
                _state.dailyLimit
            )
        );
    }

    function getMirrorProfile(string calldata _domain) external view returns (MirrorProfileV2 memory) {
        return mirrorProfiles[keccak256(bytes(_domain))];
    }

    function getMirrorVersion(string calldata _domain) external view returns (MirrorVersionV2 memory) {
        return mirrorVersions[keccak256(bytes(_domain))];
    }

    function getTypedKeys(
        string calldata _domain
    ) external view returns (KeyDescriptor memory publicKey, KeyDescriptor memory adminKey) {
        MirrorProfileV2 storage profile = mirrorProfiles[keccak256(bytes(_domain))];
        if (!mirrorVersions[keccak256(bytes(_domain))].exists) revert MirrorNotFound();
        return (profile.publicKey, profile.adminKey);
    }

    function isMirrorActive(string calldata _domain) external view returns (bool) {
        bytes32 h = keccak256(bytes(_domain));
        return mirrorVersions[h].exists && !mirrorVersions[h].revoked && mirrorProfiles[h].status == DomainStatus.ACTIVE;
    }

    function setOracleNode(address _newOracle) external onlyOwner {
        if (_newOracle == address(0)) revert InvalidAddress();
        emit OracleNodeUpdated(oracleNode, _newOracle);
        oracleNode = _newOracle;
    }

    function setGuardian(address _newGuardian) external onlyOwner {
        if (_newGuardian == address(0)) revert InvalidAddress();
        emit GuardianUpdated(guardian, _newGuardian);
        guardian = _newGuardian;
    }

    function pause() external {
        if (msg.sender != guardian && msg.sender != owner()) revert OnlyGuardianOrOwnerAllowed();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _validate(
        string calldata _domain,
        MirrorStateV2 memory _state,
        MAIVWAttestationV1.Attestation memory _attestation,
        uint8 _expectedAction,
        bytes calldata _signature
    ) private view returns (bytes32 h) {
        bytes memory domainBytes = bytes(_domain);
        _validateDomain(domainBytes);
        _validateState(_state);
        h = keccak256(domainBytes);
        if (
            _attestation.kind != KIND_STATE_ATTESTATION ||
            _attestation.action != _expectedAction ||
            _attestation.domainHash != h
        ) revert InvalidOracleProof();
        if (
            _attestation.originNetworkHash == bytes32(0) ||
            _attestation.originRegistry == bytes32(0) ||
            _attestation.evidenceHash == bytes32(0)
        ) revert InvalidMirrorOrigin();
        if (
            _attestation.destinationNetworkHash != _currentNetworkHash() ||
            _attestation.destinationRegistry != bytes32(uint256(uint160(address(this))))
        ) revert InvalidAttestationDestination();
        if (_attestation.payloadHash != hashMirrorStateV2(_state)) revert InvalidAttestationPayload();
        if (_attestation.deadline < block.timestamp && !_isExactReplay(h, _attestation)) {
            revert InvalidOracleProof();
        }
        if (ECDSA.recover(MAIVWAttestationV1.digest(_attestation), _signature) != oracleNode) {
            revert InvalidOracleProof();
        }
    }

    function _validateDomain(bytes memory _domain) private pure {
        uint256 length = _domain.length;
        if (length == 0 || length > 253) revert InvalidDomain();
        bytes1 previous = DOT;
        uint256 labelLength;
        bool hasDot;
        for (uint256 i; i < length; ++i) {
            bytes1 character = _domain[i];
            if (character == DOT) {
                if (previous == DOT || previous == HYPHEN) revert InvalidDomain();
                hasDot = true;
                labelLength = 0;
            } else {
                bool isLowercase = character >= 0x61 && character <= 0x7a;
                bool isDigit = character >= 0x30 && character <= 0x39;
                if (character == HYPHEN) {
                    if (previous == DOT) revert InvalidDomain();
                } else if (!isLowercase && !isDigit) {
                    revert InvalidDomain();
                }
                if (++labelLength > 63) revert InvalidDomain();
            }
            previous = character;
        }
        if (!hasDot || previous == DOT || previous == HYPHEN) revert InvalidDomain();
    }

    function _isExactReplay(
        bytes32 _domainHash,
        MAIVWAttestationV1.Attestation memory _attestation
    ) private view returns (bool) {
        MirrorVersionV2 storage version = mirrorVersions[_domainHash];
        return
            version.exists &&
            version.originNetworkHash == _attestation.originNetworkHash &&
            version.originRegistry == _attestation.originRegistry &&
            version.globalDomainEpoch == _attestation.globalDomainEpoch &&
            version.originSequence == _attestation.originSequence &&
            version.lastPayloadHash == _attestation.payloadHash;
    }

    function _validateState(MirrorStateV2 memory _state) private pure {
        _validateKey(_state.publicKey);
        _validateKey(_state.adminKey);
        uint256 endpointLength = bytes(_state.endpointUrl).length;
        if (endpointLength == 0 || endpointLength > MAX_ENDPOINT_LENGTH) revert InvalidMirrorState();
        if (_state.status == DomainStatus.NONE) revert InvalidMirrorState();
        if (_state.isProvider) {
            if (_state.tier == ProviderTier.NONE || _state.dailyLimit == 0) revert InvalidMirrorState();
        } else if (_state.tier != ProviderTier.NONE) {
            revert InvalidMirrorState();
        }
    }

    function _validateKey(KeyDescriptor memory _key) private pure {
        if (_key.algorithm == KeyAlgorithm.NONE || _key.keyData == bytes32(0)) revert InvalidKeyDescriptor();
        if (
            _key.algorithm == KeyAlgorithm.SECP256K1_EVM_ADDRESS &&
            uint256(_key.keyData) >> 160 != 0
        ) revert InvalidKeyDescriptor();
    }

    function _validateSameOrigin(
        MirrorVersionV2 storage _version,
        MAIVWAttestationV1.Attestation memory _attestation
    ) private view {
        if (
            _version.originNetworkHash != _attestation.originNetworkHash ||
            _version.originRegistry != _attestation.originRegistry
        ) revert MirrorOriginMismatch();
    }

    function _acceptVersion(
        MirrorVersionV2 storage _version,
        MAIVWAttestationV1.Attestation memory _attestation
    ) private view returns (bool) {
        if (
            _version.globalDomainEpoch == _attestation.globalDomainEpoch &&
            _version.originSequence == _attestation.originSequence
        ) {
            if (_version.lastPayloadHash != _attestation.payloadHash) revert MirrorVersionConflict();
            return false;
        }
        if (
            _attestation.globalDomainEpoch < _version.globalDomainEpoch ||
            (
                _attestation.globalDomainEpoch == _version.globalDomainEpoch &&
                _attestation.originSequence < _version.originSequence
            )
        ) revert MirrorVersionRegression();
        return true;
    }

    function _write(
        bytes32 _h,
        string memory _domain,
        MirrorStateV2 memory _state,
        MAIVWAttestationV1.Attestation memory _attestation,
        bool _revoked
    ) private {
        mirrorProfiles[_h] = _profile(_domain, _state);
        mirrorVersions[_h] = MirrorVersionV2({
            originNetworkHash: _attestation.originNetworkHash,
            originRegistry: _attestation.originRegistry,
            globalDomainEpoch: _attestation.globalDomainEpoch,
            originSequence: _attestation.originSequence,
            originTxReference: _attestation.evidenceHash,
            lastPayloadHash: _attestation.payloadHash,
            attestedStake: _state.attestedStake,
            dailyLimit: _state.dailyLimit,
            updatedAt: uint64(block.timestamp),
            revoked: _revoked,
            exists: true
        });
    }

    function _profile(
        string memory _domain,
        MirrorStateV2 memory _state
    ) private pure returns (MirrorProfileV2 memory) {
        return MirrorProfileV2({
            domain: _domain,
            endpointUrl: _state.endpointUrl,
            publicKey: _state.publicKey,
            adminKey: _state.adminKey,
            tlsFingerprint: _state.tlsFingerprint,
            status: _state.status,
            isProvider: _state.isProvider,
            tier: _state.tier,
            strikeCount: _state.strikeCount,
            registrationTime: _state.registrationTime
        });
    }

    function _evmDescriptor(address _key) private pure returns (KeyDescriptor memory) {
        if (_key == address(0)) revert InvalidKeyDescriptor();
        return KeyDescriptor(KeyAlgorithm.SECP256K1_EVM_ADDRESS, bytes32(uint256(uint160(_key))));
    }

    function _currentNetworkHash() private view returns (bytes32) {
        return keccak256(bytes(string.concat("evm:", Strings.toString(block.chainid))));
    }

    uint256[44] private __gap;
}
