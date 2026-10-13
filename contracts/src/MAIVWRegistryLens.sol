// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {DomainStatus, ProviderTier, CompanyProfile} from "./MAIVWRegistry.sol";

interface IMAIVWRegistry {
    function getCompanyProfile(string calldata _domain) external view returns (CompanyProfile memory);
    function getCompanyProfileByHash(bytes32 _hash) external view returns (CompanyProfile memory);
    function getRegisteredDomainCount() external view returns (uint256);
    function getDomainHashByIndex(uint256 _index) external view returns (bytes32);
    function domainMirrors(bytes32 _hash) external view returns (bool isMirror, uint256 originChainId, uint256 mirroredAt);
    function domainStakes(bytes32 _hash) external view returns (uint256);
    function providerTiers(bytes32 _hash) external view returns (ProviderTier);
    function getAllowedDailyVolume(string calldata _domain) external view returns (uint256);
    function QUARANTINE_PERIOD() external view returns (uint256);
}

/// @title MAIVWRegistryLens
/// @notice Contrato auxiliar de leitura para desonerar o bytecode do MAIVWRegistry principal (EIP-170).
///         Fornece paginação, agregações e formatações pesadas para indexadores, gateways e dashboards.
contract MAIVWRegistryLens {
    struct EnrichedProfile {
        CompanyProfile profile;
        uint256 stake;
        ProviderTier tier;
        bool isMirror;
        uint256 originChainId;
        bool inQuarantine;
        uint256 effectiveDailyLimit;
    }

    /// @notice Retorna perfis de forma paginada para evitar estouro de gas em eth_call
    /// @param registry Endereço do contrato MAIVWRegistry
    /// @param offset Índice inicial (0-indexed)
    /// @param limit Quantidade máxima de registros a retornar
    function getCompanies(
        address registry,
        uint256 offset,
        uint256 limit
    ) external view returns (CompanyProfile[] memory page) {
        IMAIVWRegistry reg = IMAIVWRegistry(registry);
        uint256 total = reg.getRegisteredDomainCount();

        if (offset >= total || limit == 0) {
            return new CompanyProfile[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        page = new CompanyProfile[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            bytes32 h = reg.getDomainHashByIndex(i);
            page[i - offset] = reg.getCompanyProfileByHash(h);
        }
    }

    /// @notice Retorna todos os domínios registrados (para compatibilidade e indexadores)
    function getAllCompanies(address registry) external view returns (CompanyProfile[] memory) {
        IMAIVWRegistry reg = IMAIVWRegistry(registry);
        uint256 total = reg.getRegisteredDomainCount();
        CompanyProfile[] memory all = new CompanyProfile[](total);
        for (uint256 i = 0; i < total; ++i) {
            bytes32 h = reg.getDomainHashByIndex(i);
            all[i] = reg.getCompanyProfileByHash(h);
        }
        return all;
    }

    /// @notice Retorna uma página de domínios com dados enriquecidos (stake, quarentena, mirror)
    function getEnrichedProfiles(
        address registry,
        string[] calldata domains
    ) external view returns (EnrichedProfile[] memory results) {
        IMAIVWRegistry reg = IMAIVWRegistry(registry);
        uint256 len = domains.length;
        results = new EnrichedProfile[](len);

        uint256 quarantinePeriod = reg.QUARANTINE_PERIOD();

        for (uint256 i = 0; i < len; ++i) {
            results[i] = _getEnrichedProfile(reg, domains[i], quarantinePeriod);
        }
    }

    function _getEnrichedProfile(
        IMAIVWRegistry reg,
        string calldata domain,
        uint256 quarantinePeriod
    ) private view returns (EnrichedProfile memory result) {
        bytes32 h = keccak256(bytes(domain));
        result.profile = reg.getCompanyProfile(domain);
        result.stake = reg.domainStakes(h);
        result.tier = reg.providerTiers(h);
        (result.isMirror, result.originChainId, ) = reg.domainMirrors(h);

        if (result.profile.status != DomainStatus.ACTIVE) return result;
        result.effectiveDailyLimit = reg.getAllowedDailyVolume(domain);
        if (!result.profile.isProvider && block.timestamp - result.profile.registrationTime < quarantinePeriod) {
            result.inQuarantine = true;
        }
    }
}
