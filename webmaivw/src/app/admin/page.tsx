"use client";
import { runtimePublicValue } from "@/lib/runtime-public-config";

import React, { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Globe,
  Plus,
  Mail,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Shield,
  Eye,
  EyeOff,
  Code2,
  Terminal,
  Settings as SettingsIcon,
  LogOut,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  ChevronRight,
  ArrowLeft,
  Server,
  Key,
  Clock,
  Radio,
  Sparkles,
  ShieldCheck,
  CheckCircle,
  Coins,
  Zap,
  AlertTriangle,
  Lock,
  Route,
  Network,
  ShieldOff,
  Layers,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Send,
  Info,
  CreditCard,
  QrCode,
  Ticket,
  Wallet,
} from "lucide-react";
import { useAuth, type DomainSummary } from "@/contexts/AuthContext";
import { EMAIL_PRESETS, type EmailProviderPreset } from "@/lib/emailPresets";
import {
  connectWeb3Wallet,
  ensureWalletChain,
  encodeRegisterMirrorCall,
  sendWeb3Transaction,
  SUPPORTED_CHAINS,
} from "@/lib/web3";

interface PrivateRouteItem {
  id?: number;
  targetDomain: string;
  privateEndpointUrl: string;
  stealthToken?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface Account {
  id: number;
  email: string;
  localPart: string;
  displayName: string | null;
  isActive: boolean;
  createdAt: string;
}

interface ApiKeyItem {
  id: number;
  name: string;
  key: string;
  environment: "Production" | "Staging";
  domainId: number;
  domainName: string;
  createdAt: string;
  lastUsed: string;
}

interface TransmissionLog {
  id: string;
  from: string;
  to: string;
  subject: string;
  msgClass: string;
  routing: string;
  status: string;
  timestamp: string;
  fullDate: string;
}

type TabType = "accounts" | "developer" | "smtp" | "onchain" | "routing";

function AdminConsole() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading, domains, refreshDomains, logout, gatewayUrl } = useAuth();

  // Selected domain view state (null = all domains overview)
  const [viewingDomainId, setViewingDomainId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>("accounts");

  // Tab 1: Accounts State
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [isAccountModalOpen, setIsAccountModalOpen] = useState(false);
  const [newLocalPart, setNewLocalPart] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isCreatingAccount, setIsCreatingAccount] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSuccess, setAccountSuccess] = useState<string | null>(null);

  // Tab 2: Developer & API Keys State
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [transmissionLogs, setTransmissionLogs] = useState<TransmissionLog[]>([]);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyEnv, setNewKeyEnv] = useState<"production" | "staging">("production");
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [activeCodeSnippet, setActiveCodeSnippet] = useState<"curl" | "node" | "python">("curl");

  // Tab 3: SMTP Settings State
  const [smtpProvider, setSmtpProvider] = useState("resend");
  const [smtpApiKey, setSmtpApiKey] = useState("");
  const [showSmtpApiKey, setShowSmtpApiKey] = useState(false);
  const [smtpFromName, setSmtpFromName] = useState("");
  const [smtpFromEmail, setSmtpFromEmail] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState<number | string>(465);
  const [smtpSecure, setSmtpSecure] = useState(true);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState<number | string>(993);
  const [imapSecure, setImapSecure] = useState(true);
  const [imapUser, setImapUser] = useState("");
  const [showAdvancedSmtp, setShowAdvancedSmtp] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState("");
  const [isSavingSmtp, setIsSavingSmtp] = useState(false);
  const [isTestingSmtp, setIsTestingSmtp] = useState(false);
  const [isSendingTestEmail, setIsSendingTestEmail] = useState(false);
  const [smtpTestResult, setSmtpTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [smtpSaveResult, setSmtpSaveResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Tab 4: Governança & Tiers (Fase 13)
  const [domainEconomics, setDomainEconomics] = useState<{
    domain: string;
    endpointUrl?: string;
    tier: number;
    tierName: string;
    balanceWei: string;
    dailyLimit: number | string;
    isActive: boolean;
    strikeCount: number;
    isSuspended: boolean;
  } | null>(null);
  const [isTopUpOpen, setIsTopUpOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("1");
  const [isSubmittingTopUp, setIsSubmittingTopUp] = useState(false);
  const [topUpSuccessMsg, setTopUpSuccessMsg] = useState<string | null>(null);

  // Tab 4: Edição de Endpoint On-Chain
  const [editingEndpoint, setEditingEndpoint] = useState("");
  const [isUpdatingEndpoint, setIsUpdatingEndpoint] = useState(false);
  const [endpointUpdateMsg, setEndpointUpdateMsg] = useState<{ ok: boolean; message: string } | null>(null);

  // Tab 4: Modo de Segurança (Público, Híbrido, Dark Total) & Rotas Privadas
  type SecurityMode = "public" | "hybrid" | "dark";
  const [securityMode, setSecurityMode] = useState<SecurityMode>("public");
  const [syncOnChain, setSyncOnChain] = useState<boolean>(true);
  const [stealthConfig, setStealthConfig] = useState<{
    isStealthEnabled: boolean;
    inboundToken: string;
  }>({ isStealthEnabled: false, inboundToken: "" });
  const [isSavingStealth, setIsSavingStealth] = useState(false);
  const [stealthSaveMsg, setStealthSaveMsg] = useState<{ ok: boolean; message: string } | null>(null);

  const [privateRoutes, setPrivateRoutes] = useState<PrivateRouteItem[]>([]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [newTargetDomain, setNewTargetDomain] = useState("");
  const [newPrivateUrl, setNewPrivateUrl] = useState("");
  const [newStealthToken, setNewStealthToken] = useState("");
  const [newRouteNotes, setNewRouteNotes] = useState("");
  const [isAddingRoute, setIsAddingRoute] = useState(false);
  const [routeMsg, setRouteMsg] = useState<{ ok: boolean; message: string } | null>(null);

  // Tab 4: Multi-Chain & Espelhamento Opcional
  interface MultiChainNetwork {
    id: number | string;
    name: string;
    symbol: string;
    isPrimary: boolean;
    rpcUrl?: string;
    contractAddress?: string | null;
    mirrorFeeFormatted: string;
    mirrorFeeWei?: string;
    explorerUrl?: string;
    status: "ACTIVE_PRIMARY" | "MIRRORED" | "NOT_MIRRORED" | "INACTIVE";
    isActive: boolean;
    isOrigin: boolean;
  }

  interface MultiChainStatusData {
    success: boolean;
    domain: string;
    isPrimaryActive: boolean;
    originChain?: string;
    mirrorInfo?: {
      isMirror: boolean;
      originChainId: number | string;
      mirroredAt: number;
    };
    networks: MultiChainNetwork[];
  }

  const [onchainSubTab, setOnchainSubTab] = useState<"overview" | "multichain" | "security" | "governance">("overview");
  const [multiChainData, setMultiChainData] = useState<MultiChainStatusData | null>(null);
  const [isLoadingMultiChain, setIsLoadingMultiChain] = useState<boolean>(false);
  const [attestingChainId, setAttestingChainId] = useState<number | string | null>(null);
  const [mirrorModalData, setMirrorModalData] = useState<{
    targetNetworkName: string;
    txHash: string;
    mirrorFee: string;
    explorerUrl?: string;
  } | null>(null);
  const [mirrorError, setMirrorError] = useState<string | null>(null);

  // Mirror Payment Modal State
  const [isMirrorPaymentModalOpen, setIsMirrorPaymentModalOpen] = useState(false);
  const [pendingMirrorTargetNet, setPendingMirrorTargetNet] = useState<MultiChainNetwork | null>(null);
  const [mirrorPaymentMethod, setMirrorPaymentMethod] = useState<"pix" | "card" | "voucher" | "web3">("pix");
  const [mirrorVoucherKey, setMirrorVoucherKey] = useState("");
  const [isCreatingMirrorPayment, setIsCreatingMirrorPayment] = useState(false);
  const [mirrorPaymentData, setMirrorPaymentData] = useState<{
    orderId: string;
    pixQrCode?: string;
    pixCopyPaste?: string;
    checkoutUrl?: string;
    amountUsd: number;
    amountBrl: number;
    isTestnet: boolean;
  } | null>(null);
  const [isPollingMirrorPix, setIsPollingMirrorPix] = useState(false);
  const [isConfirmingMirrorTestnet, setIsConfirmingMirrorTestnet] = useState(false);
  const [mirrorPaymentError, setMirrorPaymentError] = useState<string | null>(null);
  const [isConnectingWeb3Mirror, setIsConnectingWeb3Mirror] = useState(false);
  const [mirrorWeb3WalletAddress, setMirrorWeb3WalletAddress] = useState<string | null>(null);
  const [mirrorWeb3StatusStep, setMirrorWeb3StatusStep] = useState<string | null>(null);

  // Tab 5: Clusters P2P, Nós & Roteamento Dinâmico (Governança da Plataforma)
  interface RoutingNode {
    id: number;
    poolId: number;
    name: string;
    endpointUrl: string;
    weight: number;
    isActive: boolean;
    isHealthy: boolean;
    failureCount: number;
    lastFailure?: string | null;
    lastChecked?: string | null;
    responseTimeMs?: number | null;
  }

  interface RoutingPool {
    id: number;
    code: string;
    name: string;
    description?: string | null;
    region?: string | null;
    isDefault: boolean;
    isActive: boolean;
    nodes: RoutingNode[];
    domainRules?: RoutingRule[];
  }

  interface RoutingRule {
    id: number;
    domainPattern: string;
    poolId: number;
    priority: number;
    isActive: boolean;
    notes?: string | null;
    pool?: { id: number; code: string; name: string };
  }

  const [routingPools, setRoutingPools] = useState<RoutingPool[]>([]);
  const [routingRules, setRoutingRules] = useState<RoutingRule[]>([]);
  const [isLoadingRouting, setIsLoadingRouting] = useState(false);
  const [routingActionMsg, setRoutingActionMsg] = useState<{ ok: boolean; message: string } | null>(null);

  // Modal: Add Pool
  const [isAddPoolModalOpen, setIsAddPoolModalOpen] = useState(false);
  const [newPoolCode, setNewPoolCode] = useState("");
  const [newPoolName, setNewPoolName] = useState("");
  const [newPoolRegion, setNewPoolRegion] = useState("GLOBAL");
  const [newPoolDesc, setNewPoolDesc] = useState("");
  const [newPoolIsDefault, setNewPoolIsDefault] = useState(false);
  const [isSubmittingPool, setIsSubmittingPool] = useState(false);

  // Modal: Add Node
  const [isAddNodeModalOpen, setIsAddNodeModalOpen] = useState(false);
  const [selectedPoolIdForNode, setSelectedPoolIdForNode] = useState<number | null>(null);
  const [newNodeName, setNewNodeName] = useState("");
  const [newNodeUrl, setNewNodeUrl] = useState("");
  const [newNodeWeight, setNewNodeWeight] = useState(100);
  const [isSubmittingNode, setIsSubmittingNode] = useState(false);

  // Modal: Add Rule
  const [isAddRuleModalOpen, setIsAddRuleModalOpen] = useState(false);
  const [newRulePattern, setNewRulePattern] = useState("");
  const [newRulePoolId, setNewRulePoolId] = useState<number | null>(null);
  const [newRulePriority, setNewRulePriority] = useState(10);
  const [newRuleNotes, setNewRuleNotes] = useState("");
  const [isSubmittingRule, setIsSubmittingRule] = useState(false);

  // Simulator
  const [simulateDomainInput, setSimulateDomainInput] = useState("");
  const [simulateResult, setSimulateResult] = useState<any | null>(null);
  const [isSimulatingRoute, setIsSimulatingRoute] = useState(false);

  // General Helpers
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Auth Guard: Admin only
  useEffect(() => {
    if (!isLoading) {
      if (!user) {
        router.replace("/login");
        return;
      }
      if (user.role !== "admin") {
        router.replace("/inbox");
        return;
      }
    }
  }, [user, isLoading, router]);

  // Initial URL params sync
  useEffect(() => {
    const domainIdParam = searchParams.get("domainId");
    const tabParam = searchParams.get("tab") as TabType | null;

    if (domainIdParam) {
      const parsedId = parseInt(domainIdParam, 10);
      if (!isNaN(parsedId)) setViewingDomainId(parsedId);
    }
    if (tabParam && ["accounts", "developer", "smtp", "onchain", "routing"].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Active domain object
  const currentDomain: DomainSummary | undefined = domains.find((d) => d.id === viewingDomainId);

  // Load Accounts for viewing domain
  const loadAccounts = async (domainId: number) => {
    setIsLoadingAccounts(true);
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/auth/accounts?domainId=${domainId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
      }
    } catch {
      // Fallback
    } finally {
      setIsLoadingAccounts(false);
    }
  };

  // Load API Keys for viewing domain
  const loadApiKeys = async (domainId: number) => {
    setIsLoadingKeys(true);
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/api-keys?domainId=${domainId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.keys || []);
      }
    } catch {
      // Fallback
    } finally {
      setIsLoadingKeys(false);
    }
  };

  // Load Transmission Logs for viewing domain
  const loadLogs = async (domainId: number) => {
    setIsLoadingLogs(true);
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/developer/logs?domainId=${domainId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        setTransmissionLogs(data.logs || []);
      }
    } catch {
      // Fallback
    } finally {
      setIsLoadingLogs(false);
    }
  };

  // Load SMTP Config for viewing domain
  const loadSmtpConfig = async (domainId: number) => {
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/settings/smtp?domainId=${domainId}`, { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.provider) setSmtpProvider(data.provider);
        if (data.fromName) setSmtpFromName(data.fromName);
        if (data.fromEmail) setSmtpFromEmail(data.fromEmail);
        if (data.smtpHost) setSmtpHost(data.smtpHost);
        if (data.smtpPort) setSmtpPort(data.smtpPort);
        if (data.smtpSecure !== undefined) setSmtpSecure(data.smtpSecure);
        if (data.smtpUser) setSmtpUser(data.smtpUser);
        if (data.imapHost) setImapHost(data.imapHost);
        if (data.imapPort) setImapPort(data.imapPort);
        if (data.imapSecure !== undefined) setImapSecure(data.imapSecure);
        if (data.imapUser) setImapUser(data.imapUser);
        setHasSavedPassword(Boolean(data.hasPassword));
      }
    } catch {}
  };

  // Load Economics for viewing domain
  const loadEconomics = async (domainName: string) => {
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/economics/provider/${domainName}`);
      if (res.ok) {
        const data = await res.json();
        setDomainEconomics(data);
        if (data.endpointUrl) {
          setEditingEndpoint(data.endpointUrl);
        }
      } else {
        setDomainEconomics(null);
      }
    } catch {
      setDomainEconomics(null);
    }
  };

  const handleUpdateEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentDomain || !editingEndpoint.trim()) return;
    setIsUpdatingEndpoint(true);
    setEndpointUpdateMsg(null);
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/economics/endpoint`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: currentDomain.domainName,
          endpointUrl: editingEndpoint.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setEndpointUpdateMsg({
          ok: true,
          message: `Endpoint P2P atualizado no contrato on-chain com sucesso! ${data.txHash ? `(Tx: ${data.txHash.slice(0, 10)}...)` : ""}`,
        });
        await loadEconomics(currentDomain.domainName);
      } else {
        setEndpointUpdateMsg({
          ok: false,
          message: data.message || data.error || "Falha ao atualizar endpoint no contrato",
        });
      }
    } catch (err: any) {
      setEndpointUpdateMsg({
        ok: false,
        message: err.message || "Erro de conexão com o Gateway",
      });
    } finally {
      setIsUpdatingEndpoint(false);
    }
  };

  const handleExecuteTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentDomain) return;
    setIsSubmittingTopUp(true);
    setTopUpSuccessMsg(null);
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/economics/topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: currentDomain.domainName, amountEth: topUpAmount }),
      });
      const data = await res.json();
      if (res.ok) {
        setTopUpSuccessMsg(`Recarga de ${topUpAmount} ETH confirmada!`);
        await loadEconomics(currentDomain.domainName);
        setTimeout(() => {
          setIsTopUpOpen(false);
          setTopUpSuccessMsg(null);
        }, 1500);
      } else {
        alert(data.message || data.error || "Falha na recarga");
      }
    } catch (err: any) {
      alert(err.message || "Erro de conexão");
    } finally {
      setIsSubmittingTopUp(false);
    }
  };

  const loadStealthConfig = async (domainName: string) => {
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/stealth/config/${domainName}`);
      if (res.ok) {
        const data = await res.json();
        const mode: SecurityMode = data.mode || (data.isEndpointDarkOnChain ? "dark" : data.isStealthEnabled ? "dark" : "public");
        setSecurityMode(mode);
        setStealthConfig({
          isStealthEnabled: mode === "dark",
          inboundToken: data.inboundToken || "",
        });
        if (data.onChainEndpoint && data.onChainEndpoint !== "PRIVATE" && data.onChainEndpoint !== "STEALTH") {
          setEditingEndpoint(data.onChainEndpoint);
        }
      }
    } catch {
      // fallback
    }
  };

  const handleApplySecurityMode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentDomain) return;
    setIsSavingStealth(true);
    setStealthSaveMsg(null);
    try {
      const isDark = securityMode === "dark";
      const payload = {
        mode: securityMode,
        isStealthEnabled: isDark,
        inboundToken: stealthConfig.inboundToken.trim() || undefined,
        endpointUrl: isDark ? "PRIVATE" : editingEndpoint.trim(),
        syncOnChain,
      };

      const res = await fetch(`${gatewayUrl}/api/v1/stealth/config/${currentDomain.domainName}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        const modeLabels = {
          public: "Modo Público (Nível 1)",
          hybrid: "Modo Híbrido (Dual-Stack)",
          dark: "Modo Dark Total (Nível 3/4)",
        };
        setStealthSaveMsg({
          ok: true,
          message: `Postura de Segurança atualizada para ${modeLabels[securityMode]} com sucesso! ${data.onChainTxHash ? `(Blockchain Tx: ${data.onChainTxHash.slice(0, 10)}...)` : ""}`,
        });
        await loadEconomics(currentDomain.domainName);
        await loadStealthConfig(currentDomain.domainName);
      } else {
        setStealthSaveMsg({
          ok: false,
          message: data.message || data.error || "Falha ao salvar postura de segurança",
        });
      }
    } catch (err: any) {
      setStealthSaveMsg({
        ok: false,
        message: err.message || "Erro ao conectar com Gateway",
      });
    } finally {
      setIsSavingStealth(false);
    }
  };

  const generateRandomToken = () => {
    const chars = "abcdef0123456789";
    let token = "maivw_st_";
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setStealthConfig((prev) => ({ ...prev, inboundToken: token }));
  };

  const loadPrivateRoutes = async () => {
    setIsLoadingRoutes(true);
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/stealth/routes`);
      if (res.ok) {
        const data = await res.json();
        setPrivateRoutes(data.routes || []);
      }
    } catch {
      // fallback
    } finally {
      setIsLoadingRoutes(false);
    }
  };

  const handleAddPrivateRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTargetDomain.trim() || !newPrivateUrl.trim()) return;
    setIsAddingRoute(true);
    setRouteMsg(null);
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/stealth/routes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetDomain: newTargetDomain.trim(),
          privateEndpointUrl: newPrivateUrl.trim(),
          stealthToken: newStealthToken.trim() || undefined,
          notes: newRouteNotes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setRouteMsg({
          ok: true,
          message: `Rota privada para "${data.route?.targetDomain || newTargetDomain}" cadastrada com sucesso!`,
        });
        setNewTargetDomain("");
        setNewPrivateUrl("");
        setNewStealthToken("");
        setNewRouteNotes("");
        await loadPrivateRoutes();
      } else {
        setRouteMsg({
          ok: false,
          message: data.message || data.error || "Erro ao adicionar rota privada",
        });
      }
    } catch (err: any) {
      setRouteMsg({
        ok: false,
        message: err.message || "Erro de conexão",
      });
    } finally {
      setIsAddingRoute(false);
    }
  };

  const handleDeletePrivateRoute = async (targetDomain: string) => {
    if (!confirm(`Remover rota privada bilateral para "${targetDomain}"? Disparos para este domínio voltarão a depender do endpoint público registrado on-chain.`)) return;
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/stealth/routes/${targetDomain}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await loadPrivateRoutes();
      }
    } catch {
      // fallback
    }
  };

  const loadMultiChainStatus = async (domainName: string) => {
    setIsLoadingMultiChain(true);
    setMirrorError(null);
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/multichain/status/${domainName}`);
      if (res.ok) {
        const data = await res.json();
        setMultiChainData(data);
      }
    } catch {
      // fallback
    } finally {
      setIsLoadingMultiChain(false);
    }
  };

  const handleActivateMirror = async (targetChainId: number | string) => {
    if (!currentDomain) return;
    setAttestingChainId(targetChainId);
    setMirrorError(null);
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/multichain/attest-mirror`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: currentDomain.domainName,
          targetChainId,
          executeRelayer: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMirrorError(data.message || data.error || "Falha ao solicitar espelhamento");
        return;
      }

      setMirrorModalData({
        targetNetworkName: data.targetNetworkName,
        txHash: data.transaction?.txHash || "0x" + Math.random().toString(16).slice(2),
        mirrorFee: data.mirrorFeeFormatted,
        explorerUrl: data.transaction?.explorerUrl,
      });

      await loadMultiChainStatus(currentDomain.domainName);
    } catch (err: any) {
      setMirrorError(err.message || "Erro de conexão ao ativar espelhamento");
    } finally {
      setAttestingChainId(null);
    }
  };

  const paymentApiUrl =
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
      ? "http://localhost:3003"
      : runtimePublicValue('NEXT_PUBLIC_PAYMENT_API_URL') || "http://localhost:3003";

  const handleOpenMirrorPayment = (net: MultiChainNetwork) => {
    setPendingMirrorTargetNet(net);
    setMirrorPaymentMethod("pix");
    setMirrorPaymentData(null);
    setMirrorPaymentError(null);
    setIsMirrorPaymentModalOpen(true);
  };

  const handleCreateMirrorPayment = async (selectedMethod: "pix" | "card" | "voucher" | "web3") => {
    if (!currentDomain || !pendingMirrorTargetNet) return;
    setIsCreatingMirrorPayment(true);
    setMirrorPaymentError(null);

    try {
      const res = await fetch(`${paymentApiUrl}/api/v1/checkout/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: currentDomain.domainName,
          userId: user?.id || 1,
          orderType: "multichain_mirror",
          method: selectedMethod,
          targetChainId: pendingMirrorTargetNet.id,
          licenseKey: selectedMethod === "voucher" ? mirrorVoucherKey.trim() : undefined,
          customerEmail: user?.email,
          customerName: user?.displayName || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMirrorPaymentError(data.error || data.message || "Falha ao gerar cobrança de espelhamento");
        return;
      }

      if (selectedMethod === "voucher") {
        setIsMirrorPaymentModalOpen(false);
        setMirrorModalData({
          targetNetworkName: pendingMirrorTargetNet.name,
          txHash: data.txHash || "0x" + Math.random().toString(16).slice(2),
          mirrorFee: "$10.00 USD (B2B Voucher)",
          explorerUrl: pendingMirrorTargetNet.explorerUrl ? `${pendingMirrorTargetNet.explorerUrl}/tx/${data.txHash}` : undefined,
        });
        await loadMultiChainStatus(currentDomain.domainName);
        return;
      }

      setMirrorPaymentData({
        orderId: data.orderId,
        pixQrCode: data.pixQrCode,
        pixCopyPaste: data.pixCopyPaste,
        checkoutUrl: data.checkoutUrl,
        amountUsd: data.amountUsd,
        amountBrl: data.amountBrl,
        isTestnet: !!data.isTestnet,
      });

      setIsPollingMirrorPix(true);
    } catch (err: any) {
      setMirrorPaymentError(err.message || "Erro de conexão ao criar pagamento");
    } finally {
      setIsCreatingMirrorPayment(false);
    }
  };

  const handleConfirmMirrorTestnet = async () => {
    if (!mirrorPaymentData?.orderId || !pendingMirrorTargetNet || !currentDomain) return;
    setIsConfirmingMirrorTestnet(true);
    setMirrorPaymentError(null);

    try {
      const res = await fetch(`${paymentApiUrl}/api/v1/checkout/testnet-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: mirrorPaymentData.orderId }),
      });

      const data = await res.json();
      if (!res.ok) {
        setMirrorPaymentError(data.error || data.message || "Falha na confirmação simulada");
        return;
      }

      setIsMirrorPaymentModalOpen(false);
      setIsPollingMirrorPix(false);
      setMirrorModalData({
        targetNetworkName: pendingMirrorTargetNet.name,
        txHash: data.txHash || "0x" + Math.random().toString(16).slice(2),
        mirrorFee: "$10.00 USD (Testnet Subsidy)",
        explorerUrl: pendingMirrorTargetNet.explorerUrl ? `${pendingMirrorTargetNet.explorerUrl}/tx/${data.txHash}` : undefined,
      });
      await loadMultiChainStatus(currentDomain.domainName);
    } catch (err: any) {
      setMirrorPaymentError(err.message || "Erro ao confirmar pagamento simulado");
    } finally {
      setIsConfirmingMirrorTestnet(false);
    }
  };

  // Polling em background para o pagamento de espelhamento PIX/Cartão
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPollingMirrorPix && mirrorPaymentData?.orderId && isMirrorPaymentModalOpen) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`${paymentApiUrl}/api/v1/checkout/status/${mirrorPaymentData.orderId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.status === "PAID") {
              setIsPollingMirrorPix(false);
              setIsMirrorPaymentModalOpen(false);
              if (pendingMirrorTargetNet && currentDomain) {
                setMirrorModalData({
                  targetNetworkName: pendingMirrorTargetNet.name,
                  txHash: data.txHash || "0x" + Math.random().toString(16).slice(2),
                  mirrorFee: "$10.00 USD / R$ 55,00",
                  explorerUrl: pendingMirrorTargetNet.explorerUrl ? `${pendingMirrorTargetNet.explorerUrl}/tx/${data.txHash}` : undefined,
                });
                loadMultiChainStatus(currentDomain.domainName);
              }
            }
          }
        } catch {
          // ignore polling errors
        }
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [isPollingMirrorPix, mirrorPaymentData?.orderId, isMirrorPaymentModalOpen, pendingMirrorTargetNet, currentDomain]);

  const handlePayWeb3MirrorDirect = async () => {
    if (!pendingMirrorTargetNet || !currentDomain) return;
    setIsConnectingWeb3Mirror(true);
    setMirrorPaymentError(null);
    setMirrorWeb3StatusStep("Conectando à carteira Web3...");

    try {
      // 1. Obter endereço da carteira Web3
      let caller = mirrorWeb3WalletAddress;
      if (!caller) {
        caller = await connectWeb3Wallet();
        setMirrorWeb3WalletAddress(caller);
      }

      // 2. Chamar o Gateway para obter a Prova de Espelhamento do Oráculo (ECDSA)
      setMirrorWeb3StatusStep("Obtendo Prova de Espelhamento do Oráculo...");
      const attestRes = await fetch(`${gatewayUrl}/api/v1/multichain/attest-mirror`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: currentDomain.domainName,
          targetChainId: pendingMirrorTargetNet.id,
          callerAddress: caller,
          executeRelayer: false,
        }),
      });

      const attestData = await attestRes.json();
      if (!attestRes.ok) {
        throw new Error(attestData.message || attestData.error || "Falha ao obter Prova de Espelhamento do Oráculo");
      }

      // 3. Alternar carteira para a rede de destino
      setMirrorWeb3StatusStep(`Alternando carteira para a rede ${attestData.targetNetworkName}...`);
      await ensureWalletChain(attestData.targetChainId);

      // 4. Codificar a função registerMirror
      setMirrorWeb3StatusStep("Aguardando confirmação e taxa de espelho na sua carteira...");
      const callData = encodeRegisterMirrorCall({
        domain: attestData.domain,
        endpoint: attestData.endpointUrl,
        publicKey: attestData.publicKey as `0x${string}`,
        originChainId: BigInt(attestData.originChainId),
        oracleProof: attestData.oracleProof as `0x${string}`,
      });

      // 5. Enviar a transação na rede de destino pagando a mirrorFeeWei
      const txHash = await sendWeb3Transaction({
        from: caller as `0x${string}`,
        to: attestData.targetContractAddress as `0x${string}`,
        data: callData,
        valueWei: attestData.mirrorFeeWei,
      });

      // 6. Atualizar UI e fechar modal de checkout
      setIsMirrorPaymentModalOpen(false);
      setMirrorModalData({
        targetNetworkName: attestData.targetNetworkName,
        txHash,
        mirrorFee: attestData.mirrorFeeFormatted,
        explorerUrl: pendingMirrorTargetNet.explorerUrl ? `${pendingMirrorTargetNet.explorerUrl}/tx/${txHash}` : undefined,
      });

      await loadMultiChainStatus(currentDomain.domainName);
    } catch (err: any) {
      console.error("[WEB3-DIRECT-MIRROR] Error:", err);
      const msg = err?.message || "Falha ao assinar espelhamento Web3";
      setMirrorPaymentError(msg);
    } finally {
      setIsConnectingWeb3Mirror(false);
      setMirrorWeb3StatusStep(null);
    }
  };

  // Fetch data when domain changes or tab is onchain
  useEffect(() => {
    if (activeTab === "routing") {
      loadRoutingData();
    }
    if (viewingDomainId) {
      loadAccounts(viewingDomainId);
      loadApiKeys(viewingDomainId);
      loadLogs(viewingDomainId);
      loadSmtpConfig(viewingDomainId);
    }
    if (currentDomain) {
      loadEconomics(currentDomain.domainName);
      loadStealthConfig(currentDomain.domainName);
      loadPrivateRoutes();
      loadMultiChainStatus(currentDomain.domainName);
    }
  }, [viewingDomainId, currentDomain, activeTab]);

  // Tab 5: Routing Data Loader & Handlers
  const loadRoutingData = async () => {
    setIsLoadingRouting(true);
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const [poolsRes, rulesRes] = await Promise.all([
        fetch(`${gatewayUrl}/api/v1/routing/pools`, { headers }),
        fetch(`${gatewayUrl}/api/v1/routing/rules`, { headers }),
      ]);

      if (poolsRes.ok) {
        const pData = await poolsRes.json();
        setRoutingPools(pData.pools || []);
      }
      if (rulesRes.ok) {
        const rData = await rulesRes.json();
        setRoutingRules(rData.rules || []);
      }
    } catch (err: any) {
      console.error("Failed to load routing data:", err);
    } finally {
      setIsLoadingRouting(false);
    }
  };

  const handleCreatePool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPoolCode.trim() || !newPoolName.trim()) return;
    setIsSubmittingPool(true);
    setRoutingActionMsg(null);
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/routing/pools`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          code: newPoolCode.trim().toLowerCase(),
          name: newPoolName.trim(),
          region: newPoolRegion,
          description: newPoolDesc.trim() || undefined,
          isDefault: newPoolIsDefault,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setRoutingActionMsg({ ok: true, message: `Cluster "${newPoolName}" criado com sucesso e recarregado em tempo real!` });
        setIsAddPoolModalOpen(false);
        setNewPoolCode("");
        setNewPoolName("");
        setNewPoolDesc("");
        setNewPoolIsDefault(false);
        await loadRoutingData();
      } else {
        setRoutingActionMsg({ ok: false, message: data.message || data.error || "Falha ao criar cluster" });
      }
    } catch (err: any) {
      setRoutingActionMsg({ ok: false, message: err.message || "Erro de conexão ao criar cluster" });
    } finally {
      setIsSubmittingPool(false);
    }
  };

  const handleCreateNode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPoolIdForNode || !newNodeName.trim() || !newNodeUrl.trim()) return;
    setIsSubmittingNode(true);
    setRoutingActionMsg(null);
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/routing/pools/${selectedPoolIdForNode}/nodes`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: newNodeName.trim(),
          endpointUrl: newNodeUrl.trim(),
          weight: Number(newNodeWeight) || 100,
          isActive: true,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setRoutingActionMsg({ ok: true, message: `Nó "${newNodeName}" adicionado ao cluster com sucesso (Zero Gas)!` });
        setIsAddNodeModalOpen(false);
        setNewNodeName("");
        setNewNodeUrl("");
        setNewNodeWeight(100);
        await loadRoutingData();
      } else {
        setRoutingActionMsg({ ok: false, message: data.message || data.error || "Falha ao adicionar nó" });
      }
    } catch (err: any) {
      setRoutingActionMsg({ ok: false, message: err.message || "Erro de conexão ao adicionar nó" });
    } finally {
      setIsSubmittingNode(false);
    }
  };

  const handleToggleNodeActive = async (node: RoutingNode) => {
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/routing/nodes/${node.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ isActive: !node.isActive }),
      });
      if (res.ok) {
        setRoutingActionMsg({ ok: true, message: `Nó #${node.id} ${!node.isActive ? "ativado" : "desativado"} com sucesso!` });
        await loadRoutingData();
      }
    } catch (err: any) {
      setRoutingActionMsg({ ok: false, message: err.message });
    }
  };

  const handleUpdateNodeWeight = async (nodeId: number, newWeight: number) => {
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/routing/nodes/${nodeId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ weight: newWeight }),
      });
      if (res.ok) {
        setRoutingActionMsg({ ok: true, message: `Peso do Nó #${nodeId} atualizado para ${newWeight}!` });
        await loadRoutingData();
      }
    } catch (err: any) {
      setRoutingActionMsg({ ok: false, message: err.message });
    }
  };

  const handleResetNodeHealth = async (nodeId: number) => {
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/routing/nodes/${nodeId}/reset-health`, {
        method: "POST",
        headers,
      });
      if (res.ok) {
        setRoutingActionMsg({ ok: true, message: `Circuit Breaker do Nó #${nodeId} resetado! Nó reintegrado ao pool.` });
        await loadRoutingData();
      }
    } catch (err: any) {
      setRoutingActionMsg({ ok: false, message: err.message });
    }
  };

  const handleDeleteNode = async (nodeId: number) => {
    if (!confirm("Tem certeza que deseja remover este nó do cluster?")) return;
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/routing/nodes/${nodeId}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) {
        setRoutingActionMsg({ ok: true, message: `Nó #${nodeId} removido.` });
        await loadRoutingData();
      }
    } catch (err: any) {
      setRoutingActionMsg({ ok: false, message: err.message });
    }
  };

  const handleDeletePool = async (poolId: number) => {
    if (!confirm("Tem certeza que deseja excluir este cluster e todos os seus nós?")) return;
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/routing/pools/${poolId}`, {
        method: "DELETE",
        headers,
      });
      const data = await res.json();
      if (res.ok) {
        setRoutingActionMsg({ ok: true, message: data.message || "Cluster excluído." });
        await loadRoutingData();
      } else {
        setRoutingActionMsg({ ok: false, message: data.message || "Falha ao excluir cluster." });
      }
    } catch (err: any) {
      setRoutingActionMsg({ ok: false, message: err.message });
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRulePattern.trim() || !newRulePoolId) return;
    setIsSubmittingRule(true);
    setRoutingActionMsg(null);
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/routing/rules`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          domainPattern: newRulePattern.trim().toLowerCase(),
          poolId: newRulePoolId,
          priority: Number(newRulePriority) || 10,
          notes: newRuleNotes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setRoutingActionMsg({ ok: true, message: `Regra para "${newRulePattern}" criada com sucesso!` });
        setIsAddRuleModalOpen(false);
        setNewRulePattern("");
        setNewRuleNotes("");
        setNewRulePriority(10);
        await loadRoutingData();
      } else {
        setRoutingActionMsg({ ok: false, message: data.message || data.error || "Falha ao criar regra" });
      }
    } catch (err: any) {
      setRoutingActionMsg({ ok: false, message: err.message });
    } finally {
      setIsSubmittingRule(false);
    }
  };

  const handleDeleteRule = async (ruleId: number) => {
    if (!confirm("Remover esta regra de roteamento?")) return;
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/routing/rules/${ruleId}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok) {
        setRoutingActionMsg({ ok: true, message: "Regra removida com sucesso." });
        await loadRoutingData();
      }
    } catch (err: any) {
      setRoutingActionMsg({ ok: false, message: err.message });
    }
  };

  const handleRunSimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simulateDomainInput.trim()) return;
    setIsSimulatingRoute(true);
    setSimulateResult(null);
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/routing/test-resolve`, {
        method: "POST",
        headers,
        body: JSON.stringify({ domain: simulateDomainInput.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (res.ok) {
        setSimulateResult(data.simulation);
      } else {
        setRoutingActionMsg({ ok: false, message: data.message || "Erro na simulação" });
      }
    } catch (err: any) {
      setRoutingActionMsg({ ok: false, message: err.message });
    } finally {
      setIsSimulatingRoute(false);
    }
  };

  // Create Email Account Handler
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewingDomainId || !newLocalPart.trim() || newPassword.length < 12 || newPassword.length > 128) return;

    setIsCreatingAccount(true);
    setAccountError(null);
    setAccountSuccess(null);

    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/auth/accounts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          localPart: newLocalPart.trim().toLowerCase(),
          displayName: newDisplayName.trim() || undefined,
          password: newPassword,
          domainId: viewingDomainId,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setAccountSuccess(`Conta ${data.email} criada com sucesso!`);
        setNewLocalPart("");
        setNewDisplayName("");
        setNewPassword("");
        setIsAccountModalOpen(false);
        loadAccounts(viewingDomainId);
        refreshDomains();
      } else {
        setAccountError(data.message || data.error || "Erro ao criar conta");
      }
    } catch {
      setAccountError("Erro ao conectar ao servidor");
    } finally {
      setIsCreatingAccount(false);
    }
  };

  // Delete Account Handler
  const handleDeleteAccount = async (id: number, email: string) => {
    if (!confirm(`Deseja realmente excluir a caixa de e-mail ${email}?`)) return;
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/auth/accounts/${id}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok && viewingDomainId) {
        loadAccounts(viewingDomainId);
        refreshDomains();
      }
    } catch {}
  };

  // Create API Key Handler
  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewingDomainId || !newKeyName.trim()) return;

    setIsCreatingKey(true);
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/api-keys`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: newKeyName.trim(),
          environment: newKeyEnv,
          domainId: viewingDomainId,
        }),
      });

      const data = await res.json();
      if (res.ok && data.apiKey) {
        setCreatedRawKey(data.apiKey);
        setNewKeyName("");
        setIsKeyModalOpen(false);
        loadApiKeys(viewingDomainId);
        refreshDomains();
      }
    } catch {
      // Fallback
    } finally {
      setIsCreatingKey(false);
    }
  };

  // Revoke API Key Handler
  const handleRevokeApiKey = async (id: number) => {
    if (!confirm("Tem certeza que deseja revogar esta chave de API? Aplicações usando-a perderão acesso.")) return;
    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/api-keys/${id}`, {
        method: "DELETE",
        headers,
      });
      if (res.ok && viewingDomainId) {
        loadApiKeys(viewingDomainId);
        refreshDomains();
      }
    } catch {}
  };

  // Save SMTP Settings Handler
  const handleSaveSmtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!viewingDomainId) return;

    setIsSavingSmtp(true);
    setSmtpSaveResult(null);

    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const isApi = smtpProvider === "resend";
      const payload: any = {
        domainId: viewingDomainId,
        provider: smtpProvider,
        fromName: smtpFromName.trim() || undefined,
        fromEmail: smtpFromEmail.trim() || undefined,
      };

      if (isApi) {
        if (!smtpApiKey.trim() && !hasSavedPassword) {
          setSmtpSaveResult({ ok: false, message: "A Chave de API do Resend é obrigatória." });
          setIsSavingSmtp(false);
          return;
        }
        if (smtpApiKey.trim()) payload.apiKey = smtpApiKey.trim();
      } else {
        if (!smtpHost.trim()) {
          setSmtpSaveResult({ ok: false, message: "O Host do servidor SMTP é obrigatório." });
          setIsSavingSmtp(false);
          return;
        }
        if (!smtpPass.trim() && !hasSavedPassword) {
          setSmtpSaveResult({ ok: false, message: "A Senha da conta ou Senha de App é obrigatória." });
          setIsSavingSmtp(false);
          return;
        }

        payload.smtpHost = smtpHost.trim();
        payload.smtpPort = Number(smtpPort) || 465;
        payload.smtpSecure = smtpSecure;
        payload.smtpUser = smtpUser.trim();
        if (smtpPass.trim()) payload.smtpPass = smtpPass.trim();
        payload.imapHost = imapHost.trim() || smtpHost.trim();
        payload.imapPort = Number(imapPort) || 993;
        payload.imapSecure = imapSecure;
        payload.imapUser = imapUser.trim() || smtpUser.trim();
      }

      const res = await fetch(`${gatewayUrl}/api/v1/settings/smtp`, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        setSmtpSaveResult({
          ok: true,
          message: `Configurações do provedor ${smtpProvider.toUpperCase()} salvas com sucesso!`,
        });
        setHasSavedPassword(true);
        setSmtpPass("");
        setSmtpApiKey("");
        refreshDomains();
      } else {
        setSmtpSaveResult({ ok: false, message: data.message || "Erro ao salvar configurações" });
      }
    } catch {
      setSmtpSaveResult({ ok: false, message: "Falha de conexão com o servidor gateway" });
    } finally {
      setIsSavingSmtp(false);
    }
  };

  // Test SMTP Connection Handler
  const handleTestSmtp = async (withTestEmail: boolean = false) => {
    if (!viewingDomainId) return;
    if (withTestEmail) {
      setIsSendingTestEmail(true);
    } else {
      setIsTestingSmtp(true);
    }
    setSmtpTestResult(null);

    const token = user?.token || localStorage.getItem("maivw_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const isApi = smtpProvider === "resend";
      const payload: any = {
        domainId: viewingDomainId,
        provider: smtpProvider,
        testEmail: withTestEmail
          ? (testEmailAddress.trim() || smtpFromEmail.trim() || user?.email || undefined)
          : undefined,
      };

      if (isApi) {
        if (smtpApiKey.trim()) payload.apiKey = smtpApiKey.trim();
      } else {
        if (smtpHost.trim()) payload.smtpHost = smtpHost.trim();
        if (smtpPort) payload.smtpPort = Number(smtpPort);
        payload.smtpSecure = smtpSecure;
        if (smtpUser.trim()) payload.smtpUser = smtpUser.trim();
        if (smtpPass.trim()) payload.smtpPass = smtpPass.trim();
      }

      const res = await fetch(`${gatewayUrl}/api/v1/settings/smtp/test`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      setSmtpTestResult(data);
    } catch {
      setSmtpTestResult({ ok: false, message: "Falha ao realizar teste de conexão com o provedor" });
    } finally {
      setIsTestingSmtp(false);
      setIsSendingTestEmail(false);
    }
  };

  if (isLoading || !user) {
    return (
      <div className="min-h-screen bg-[#070101] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-red-600/30 border-t-red-600 rounded-full animate-spin" />
      </div>
    );
  }

  // Active Key String for snippets
  const sampleKey = createdRawKey || (apiKeys.length > 0 ? apiKeys[0].key : "maivw_live_sk_suachaveaqui");
  const sampleDomain = currentDomain?.domainName || "empresa.com.br";

  return (
    <div className="min-h-screen bg-[#070101] text-slate-100 flex flex-col justify-between selection:bg-[#7d0000] selection:text-white relative overflow-hidden">
      {/* Ambient background glows */}
      <div className="absolute -top-40 right-1/4 w-[600px] h-[600px] bg-[#7d0000]/10 rounded-full blur-[180px] pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-[450px] h-[450px] bg-[#3a0000]/15 rounded-full blur-[160px] pointer-events-none" />

      {/* Top Header - Admin Console Bar */}
      <header className="border-b border-white/[0.06] bg-[#0c0808]/85 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin" onClick={() => setViewingDomainId(null)} className="flex items-center gap-3 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7d0000] to-[#3a0000] p-[1px] shadow-lg shadow-red-950/40 flex items-center justify-center group-hover:scale-105 transition">
                <div className="w-full h-full bg-[#0a0505] rounded-[11px] flex items-center justify-center p-1.5">
                  <img src="/logo-mw-badge.png" alt="MAIVW" className="w-full h-full object-contain rounded-md" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-base font-extrabold tracking-tight text-white">MAIVW</span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/25">
                  Console Admin
                </span>
              </div>
            </Link>

            {/* Navigation Pill for Admin */}
            <div className="hidden md:flex items-center gap-1 pl-4 border-l border-white/[0.08]">
              <button
                type="button"
                onClick={() => setViewingDomainId(null)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                  viewingDomainId === null
                    ? "bg-white/[0.08] text-white font-semibold"
                    : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                Visão Geral ({domains.length})
              </button>

              {viewingDomainId !== null && currentDomain && (
                <div className="flex items-center gap-1.5 text-xs text-neutral-400">
                  <ChevronRight className="w-3.5 h-3.5 text-neutral-600" />
                  <span className="font-mono text-red-400 font-semibold">{currentDomain.domainName}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right Header: Actions & User Info */}
          <div className="flex items-center gap-3">
            <Link
              href="/onboarding"
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#7d0000] to-[#990000] hover:from-[#900000] hover:to-[#b30000] text-white text-xs font-semibold shadow-md shadow-red-950/40 transition active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Conectar Novo Domínio</span>
            </Link>

            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.07] text-xs text-neutral-300">
              <Shield className="w-3.5 h-3.5 text-red-400" />
              <span className="truncate max-w-[180px] font-medium">{user.email}</span>
            </div>

            <button
              type="button"
              onClick={() => {
                logout();
                router.push("/login");
              }}
              title="Sair da Conta"
              className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-white/[0.05] transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8 relative z-10">
        {/* ============================================================== */}
        {/* VIEW 1: VISÃO GERAL DE TODOS OS DOMÍNIOS (GRID VIEW)          */}
        {/* ============================================================== */}
        {viewingDomainId === null && (
          <div className="space-y-8">
            {/* Header with Title and Metrics */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-white/[0.06]">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
                  <span>Meus Domínios Corporativos</span>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/[0.06] text-neutral-300 border border-white/[0.08] font-normal font-mono">
                    {domains.length}
                  </span>
                </h1>
                <p className="text-xs text-neutral-400 mt-1">
                  Gerencie caixas de e-mail, chaves de API, credenciais SMTP e reputação on-chain para cada domínio.
                </p>
              </div>

              <Link
                href="/onboarding"
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-[#7d0000] to-[#990000] hover:from-[#900000] hover:to-[#b30000] text-white text-xs font-semibold shadow-lg shadow-red-950/50 flex items-center gap-2 transition active:scale-95"
              >
                <Plus className="w-4 h-4" />
                <span>Adicionar Outro Domínio</span>
              </Link>
            </div>

            {/* Metric Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-5 rounded-2xl bg-[#0e0909]/90 border border-white/[0.07] backdrop-blur-xl">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-neutral-400">Total de Domínios</span>
                  <Globe className="w-4 h-4 text-red-400" />
                </div>
                <div className="text-2xl font-bold text-white">{domains.length}</div>
                <div className="text-[11px] text-neutral-500 mt-1">Registrados sob sua gestão</div>
              </div>

              <div className="p-5 rounded-2xl bg-[#0e0909]/90 border border-white/[0.07] backdrop-blur-xl">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-neutral-400">Caixas de E-mail Criadas</span>
                  <Mail className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-2xl font-bold text-white">
                  {domains.reduce((acc, d) => acc + d.accountsCount, 0)}
                </div>
                <div className="text-[11px] text-neutral-500 mt-1">Endereços corporativos ativos</div>
              </div>

              <div className="p-5 rounded-2xl bg-[#0e0909]/90 border border-white/[0.07] backdrop-blur-xl">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-neutral-400">Rede do Cartório</span>
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-sm font-bold text-white flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Multi-Chain Protocol Registry</span>
                </div>
                <div className="text-[11px] text-neutral-500 mt-1">Solana Devnet &amp; Redes EVM</div>
              </div>
            </div>

            {/* Domains Grid */}
            {domains.length === 0 ? (
              <div className="p-12 text-center rounded-3xl bg-[#0e0909]/80 border border-white/[0.06] backdrop-blur-xl max-w-lg mx-auto">
                <div className="w-14 h-14 rounded-2xl bg-red-500/10 text-red-400 flex items-center justify-center mx-auto mb-4 border border-red-500/20">
                  <Globe className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-white">Nenhum domínio corporativo ativo</h3>
                <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">
                  Conecte seu primeiro domínio corporativo para emitir identidades criptográficas e criar caixas de e-mail.
                </p>
                <Link
                  href="/onboarding"
                  className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#7d0000] to-[#990000] hover:from-[#900000] hover:to-[#b30000] text-white text-xs font-bold shadow-lg shadow-red-950/40 transition active:scale-95"
                >
                  <Plus className="w-4 h-4" />
                  <span>Conectar Meu Domínio Agora</span>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {domains.map((dom) => (
                  <div
                    key={dom.id}
                    className="p-6 rounded-3xl bg-[#0f0a0a]/90 border border-white/[0.08] hover:border-red-900/60 transition-all shadow-xl hover:shadow-red-950/20 flex flex-col justify-between group"
                  >
                    <div>
                      {/* Card Top: Domain Name & Status */}
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center shrink-0">
                            <Globe className="w-5 h-5" />
                          </div>
                          <div>
                            <h2 className="text-sm font-bold text-white font-mono truncate max-w-[190px]">
                              {dom.domainName}
                            </h2>
                            <span className="text-[10px] text-neutral-500">
                              Cadastrado em {new Date(dom.createdAt).toLocaleDateString("pt-BR")}
                            </span>
                          </div>
                        </div>

                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                          dom.originFamily === "SOLANA"
                            ? "bg-purple-500/10 text-purple-400 border border-purple-500/25"
                            : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25"
                        }`}>
                          {dom.originNetworkName || (dom.originFamily === "SOLANA" ? "Solana Devnet" : "Base Sepolia")}
                        </span>
                      </div>

                      {/* Card Stats Pills */}
                      <div className="grid grid-cols-2 gap-2 my-4 text-xs">
                        <div className="p-2.5 bg-black/40 border border-white/[0.05] rounded-xl">
                          <div className="text-[10px] text-neutral-400">Caixas de E-mail</div>
                          <div className="text-sm font-bold text-white mt-0.5 flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-blue-400" />
                            <span>{dom.accountsCount}</span>
                          </div>
                        </div>

                        <div className="p-2.5 bg-black/40 border border-white/[0.05] rounded-xl">
                          <div className="text-[10px] text-neutral-400">Chaves de API</div>
                          <div className="text-sm font-bold text-white mt-0.5 flex items-center gap-1.5">
                            <Key className="w-3.5 h-3.5 text-purple-400" />
                            <span>{dom.apiKeysCount}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-neutral-400 py-2 border-t border-white/[0.06]">
                        <span>Provedor de Envio:</span>
                        <span className="font-semibold text-neutral-200 uppercase text-[10px]">
                          {dom.smtpConfigured ? dom.smtpProvider || "Ativo" : "Padrão MAIVW"}
                        </span>
                      </div>
                    </div>

                    {/* Manage Button */}
                    <button
                      type="button"
                      onClick={() => setViewingDomainId(dom.id)}
                      className="mt-4 w-full py-2.5 px-4 bg-white/[0.04] hover:bg-gradient-to-r hover:from-[#7d0000] hover:to-[#990000] border border-white/[0.08] hover:border-transparent rounded-xl text-xs font-semibold text-neutral-200 hover:text-white transition flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-98"
                    >
                      <span>Gerenciar Domínio</span>
                      <ChevronRight className="w-4 h-4 text-neutral-400 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* VIEW 2: HUB DE GESTÃO DO DOMÍNIO SELECIONADO                  */}
        {/* ============================================================== */}
        {viewingDomainId !== null && currentDomain && (
          <div className="space-y-6">
            {/* Top Navigation & Domain Header */}
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-6 border-b border-white/[0.06]">
              <div>
                <button
                  type="button"
                  onClick={() => setViewingDomainId(null)}
                  className="text-xs text-neutral-400 hover:text-white flex items-center gap-1.5 mb-2 transition cursor-pointer font-medium"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Voltar para Todos os Domínios</span>
                </button>

                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold tracking-tight text-white font-mono">
                    {currentDomain.domainName}
                  </h1>
                  {currentDomain.originFamily === "SOLANA" ? (
                    <span className="px-2.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/30 text-[10px] font-bold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                      Ativo na Solana Devnet
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      {currentDomain.originNetworkName || "Ativo na Base Sepolia"}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400 mt-1.5">
                  <span className="font-mono text-[11px] text-neutral-500">
                    Chave Web3: {currentDomain.publicKey ? `${currentDomain.publicKey.slice(0, 10)}...${currentDomain.publicKey.slice(-8)}` : "Gerada via KMS"}
                  </span>
                  <span>•</span>
                  <span>{currentDomain.accountsCount} caixas de e-mail</span>
                  <span>•</span>
                  <span>{currentDomain.apiKeysCount} chaves de API</span>
                </div>
              </div>

              {/* Domain Switcher Dropdown */}
              {domains.length > 1 && (
                <div className="flex items-center gap-2 bg-[#120808] border border-white/[0.08] px-3 py-1.5 rounded-xl">
                  <span className="text-[11px] text-neutral-400">Trocar Domínio:</span>
                  <select
                    value={currentDomain.id}
                    onChange={(e) => setViewingDomainId(parseInt(e.target.value, 10))}
                    className="bg-transparent text-xs font-mono font-semibold text-white focus:outline-none cursor-pointer"
                  >
                    {domains.map((d) => (
                      <option key={d.id} value={d.id} className="bg-[#120808] text-white">
                        {d.domainName}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Hub Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-white/[0.06] pb-3 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveTab("accounts")}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  activeTab === "accounts"
                    ? "bg-[#7d0000] text-white shadow-lg shadow-red-950/40"
                    : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Contas de E-mail ({accounts.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("developer")}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  activeTab === "developer"
                    ? "bg-[#7d0000] text-white shadow-lg shadow-red-950/40"
                    : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>API & Desenvolvedor ({apiKeys.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("smtp")}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  activeTab === "smtp"
                    ? "bg-[#7d0000] text-white shadow-lg shadow-red-950/40"
                    : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                <SettingsIcon className="w-3.5 h-3.5" />
                <span>Configuração & SMTP</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("onchain")}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  activeTab === "onchain"
                    ? "bg-[#7d0000] text-white shadow-lg shadow-red-950/40"
                    : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Cartório On-Chain</span>
                {currentDomain?.originFamily === "SOLANA" ? (
                  <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 text-[10px] font-bold">
                    Solana
                  </span>
                ) : (
                  <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 text-[10px] font-bold">
                    Base
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab("routing")}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${
                  activeTab === "routing"
                    ? "bg-[#7d0000] text-white shadow-lg shadow-red-950/40"
                    : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
                }`}
              >
                <Server className="w-3.5 h-3.5 text-indigo-400" />
                <span>Clusters P2P & Nós ({routingPools.length})</span>
              </button>
            </div>

            {/* ========================================================== */}
            {/* TAB 1: CONTAS DE E-MAIL                                    */}
            {/* ========================================================== */}
            {activeTab === "accounts" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-white">Caixas Postais do Domínio</h3>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      Crie endereços para colaboradores lerem e responderem e-mails no WebMaivw.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsAccountModalOpen(true)}
                    className="px-3.5 py-2 bg-gradient-to-r from-[#7d0000] to-[#990000] hover:from-[#900000] hover:to-[#b30000] text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-md shadow-red-950/40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Nova Conta de E-mail</span>
                  </button>
                </div>

                {accountSuccess && (
                  <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-xl text-xs text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{accountSuccess}</span>
                  </div>
                )}

                {/* Accounts Table */}
                <div className="bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl overflow-hidden shadow-xl">
                  {accounts.length === 0 ? (
                    <div className="p-8 text-center text-xs text-neutral-400">
                      Nenhuma conta de e-mail criada para este domínio ainda. Clique em "Nova Conta de E-mail" acima.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/[0.06]">
                      {accounts.map((acc) => (
                        <div
                          key={acc.id}
                          className="p-4 flex items-center justify-between hover:bg-white/[0.02] transition"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center">
                              <Mail className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-white font-mono">{acc.email}</div>
                              <div className="text-[11px] text-neutral-400">
                                {acc.displayName || "Sem nome informado"} • Criado em{" "}
                                {new Date(acc.createdAt).toLocaleDateString("pt-BR")}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">
                              Ativa
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteAccount(acc.id, acc.email)}
                              className="p-2 text-neutral-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition cursor-pointer"
                              title="Excluir Conta"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ========================================================== */}
            {/* TAB 2: API & DESENVOLVEDOR                                */}
            {/* ========================================================== */}
            {activeTab === "developer" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-white">Chaves de API do Domínio</h3>
                    <p className="text-xs text-neutral-400 mt-0.5">
                      Chaves secretas para autenticar disparos de e-mails via microsserviços e scripts.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setCreatedRawKey(null);
                      setIsKeyModalOpen(true);
                    }}
                    className="px-3.5 py-2 bg-gradient-to-r from-[#7d0000] to-[#990000] hover:from-[#900000] hover:to-[#b30000] text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-md shadow-red-950/40"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Gerar Nova Chave</span>
                  </button>
                </div>

                {/* API Keys Table */}
                <div className="bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl overflow-hidden shadow-xl">
                  {apiKeys.length === 0 ? (
                    <div className="p-8 text-center text-xs text-neutral-400">
                      Nenhuma chave de API gerada para este domínio. Clique em "Gerar Nova Chave" para começar.
                    </div>
                  ) : (
                    <div className="divide-y divide-white/[0.06]">
                      {apiKeys.map((k) => (
                        <div
                          key={k.id}
                          className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-white/[0.02] transition"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-white">{k.name}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/25 uppercase font-bold">
                                {k.environment}
                              </span>
                            </div>
                            <div className="text-xs font-mono text-red-300/80 mt-1 flex items-center gap-2">
                              <span>{k.key}</span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(k.key, `key_${k.id}`)}
                                className="p-1 hover:text-white transition cursor-pointer"
                                title="Copiar Hash"
                              >
                                {copiedKey === `key_${k.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                            <div className="text-[10px] text-neutral-500 mt-1">
                              Criada em {k.createdAt} • Último uso: {k.lastUsed}
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleRevokeApiKey(k.id)}
                            className="px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 border border-red-500/20 rounded-xl transition cursor-pointer shrink-0"
                          >
                            Revogar Chave
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Code Snippet Box */}
                <div className="p-6 bg-[#0c0707] border border-white/[0.08] rounded-3xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-red-400" />
                      <span className="text-xs font-bold text-white">Exemplo de Disparo Transacional</span>
                    </div>

                    <div className="flex gap-1.5 bg-black/60 p-1 rounded-xl border border-white/[0.06]">
                      <button
                        type="button"
                        onClick={() => setActiveCodeSnippet("curl")}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition cursor-pointer ${
                          activeCodeSnippet === "curl" ? "bg-white/[0.1] text-white" : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        cURL
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveCodeSnippet("node")}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition cursor-pointer ${
                          activeCodeSnippet === "node" ? "bg-white/[0.1] text-white" : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        Node.js
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveCodeSnippet("python")}
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg transition cursor-pointer ${
                          activeCodeSnippet === "python" ? "bg-white/[0.1] text-white" : "text-neutral-400 hover:text-white"
                        }`}
                      >
                        Python
                      </button>
                    </div>
                  </div>

                  <pre className="p-4 bg-black/90 border border-white/[0.06] rounded-2xl text-[11px] font-mono text-neutral-300 overflow-x-auto leading-relaxed">
                    {activeCodeSnippet === "curl" &&
`curl -X POST ${gatewayUrl}/api/v1/send \\
  -H "Authorization: Bearer ${sampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "from": "Equipe <admin@${sampleDomain}>",
    "to": "destinatario@cliente.com.br",
    "subject": "Código de Verificação",
    "msgClass": "TX_CODE",
    "text": "Seu código de acesso é 849201."
  }'`}

                    {activeCodeSnippet === "node" &&
`import { MaivwClient } from '@maivw/sdk';

const maivw = new MaivwClient({
  apiKey: '${sampleKey}',
});

await maivw.emails.send({
  from: 'Equipe <admin@${sampleDomain}>',
  to: 'destinatario@cliente.com.br',
  subject: 'Confirmação Transacional',
  msgClass: 'TX_CODE',
  text: 'Autenticado via Protocolo MAIVW on-chain.'
});`}

                    {activeCodeSnippet === "python" &&
`import requests

url = "${gatewayUrl}/api/v1/send"
headers = {
    "Authorization": "Bearer ${sampleKey}",
    "Content-Type": "application/json"
}
payload = {
    "from": "Equipe <admin@${sampleDomain}>",
    "to": "destinatario@cliente.com.br",
    "subject": "Código de Segurança",
    "msgClass": "TX_CODE",
    "text": "Seu código é 849201."
}

res = requests.post(url, json=payload, headers=headers)
print(res.json())`}
                  </pre>
                </div>

                {/* Transmission Logs Section */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-neutral-400" />
                      <span>Últimos Disparos da API deste Domínio</span>
                    </h4>
                    <button
                      type="button"
                      onClick={() => loadLogs(viewingDomainId)}
                      className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 transition cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingLogs ? "animate-spin" : ""}`} />
                      <span>Atualizar</span>
                    </button>
                  </div>

                  <div className="bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl overflow-hidden shadow-xl">
                    {transmissionLogs.length === 0 ? (
                      <div className="p-8 text-center text-xs text-neutral-500">
                        Nenhum log de disparo recente registrado para este domínio.
                      </div>
                    ) : (
                      <div className="divide-y divide-white/[0.06] text-xs">
                        {transmissionLogs.map((log) => (
                          <div key={log.id} className="p-3.5 flex items-center justify-between hover:bg-white/[0.02]">
                            <div>
                              <div className="font-semibold text-white truncate max-w-sm">{log.subject}</div>
                              <div className="text-[11px] text-neutral-400 font-mono mt-0.5">
                                {log.from} → {log.to}
                              </div>
                            </div>

                            <div className="text-right">
                              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 text-[10px] font-bold">
                                {log.routing}
                              </span>
                              <div className="text-[10px] text-neutral-500 mt-1">{log.timestamp}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ========================================================== */}
            {/* TAB 3: CONFIGURAÇÃO & PROVEDORES (SMTP / APIS)             */}
            {/* ========================================================== */}
            {activeTab === "smtp" && (
              <div className="space-y-6 max-w-4xl">
                <div className="bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl p-6 md:p-8 shadow-xl space-y-6">
                  {/* Header */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/[0.06]">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-white">Provedor de E-mail de Fallback & Soberania</h3>
                        <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/25 text-[10px] font-bold">
                          Dual-Stack Híbrido
                        </span>
                      </div>
                      <p className="text-xs text-neutral-400 mt-1.5 max-w-2xl leading-relaxed">
                        Escolha como seu domínio interage com provedores tradicionais (Gmail, Outlook, Zoho, etc.).
                        Selecione um preset abaixo para carregar as portas e protocolos mais seguros recomendados (SSL 465 / TLS 587) ou use sua própria infraestrutura corporativa.
                      </p>
                    </div>

                    {hasSavedPassword && (
                      <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        <span>Cofre Ativo</span>
                      </div>
                    )}
                  </div>

                  {/* 1. Grid de Presets de Provedores Conhecidos */}
                  <div>
                    <label className="block text-xs font-semibold text-neutral-300 mb-3 flex items-center justify-between">
                      <span>Selecione seu Provedor de E-mail:</span>
                      <span className="text-[11px] text-neutral-500 font-normal">
                        Preenchimento automático do modo mais seguro
                      </span>
                    </label>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {EMAIL_PRESETS.map((preset) => {
                        const isSelected = smtpProvider === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => {
                              setSmtpProvider(preset.id);
                              setSmtpTestResult(null);
                              setSmtpSaveResult(null);
                              if (preset.category === "smtp") {
                                const resolvedHost = preset.id === "cpanel" && currentDomain
                                  ? `mail.${currentDomain.domainName}`
                                  : (preset.smtpHost || "");
                                const resolvedImap = preset.id === "cpanel" && currentDomain
                                  ? `mail.${currentDomain.domainName}`
                                  : (preset.imapHost || "");

                                setSmtpHost(resolvedHost);
                                setSmtpPort(preset.smtpPort || 465);
                                setSmtpSecure(preset.smtpSecure !== undefined ? preset.smtpSecure : true);
                                setImapHost(resolvedImap);
                                setImapPort(preset.imapPort || 993);
                                setImapSecure(preset.imapSecure !== undefined ? preset.imapSecure : true);
                                if (!smtpFromEmail && currentDomain) {
                                  setSmtpFromEmail(`contato@${currentDomain.domainName}`);
                                }
                                if (!smtpUser && currentDomain) {
                                  setSmtpUser(`contato@${currentDomain.domainName}`);
                                }
                              }
                            }}
                            className={`p-3.5 rounded-2xl border text-left transition relative cursor-pointer flex flex-col justify-between ${
                              isSelected
                                ? "bg-gradient-to-br from-[#7d0000]/25 to-[#3a0000]/15 border-red-500/60 shadow-lg shadow-red-950/30"
                                : "bg-[#140d0d] border-white/[0.07] hover:border-white/[0.15] hover:bg-white/[0.02]"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                                <span>{preset.name}</span>
                              </div>
                              <span
                                className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                  isSelected
                                    ? "bg-red-500/20 text-red-300 border border-red-500/40"
                                    : "bg-white/[0.05] text-neutral-400 border border-white/[0.08]"
                                }`}
                              >
                                {preset.badge}
                              </span>
                            </div>

                            <p className="text-[11px] text-neutral-400 mt-2 line-clamp-2">
                              {preset.description}
                            </p>

                            <div className="mt-3 pt-2.5 border-t border-white/[0.04] flex items-center justify-between text-[10px]">
                              <span className="text-neutral-500 font-mono">
                                {preset.category === "api" ? "REST API" : `${preset.smtpHost ? preset.smtpHost.replace("{domain}", currentDomain?.domainName || "...") : "Custom"}:${preset.smtpPort || 465}`}
                              </span>
                              {isSelected ? (
                                <span className="text-emerald-400 flex items-center gap-1 font-bold">
                                  <Check className="w-3 h-3" /> Selecionado
                                </span>
                              ) : (
                                <span className="text-neutral-500 group-hover:text-neutral-300">Escolher &rarr;</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 2. Dica de Segurança e Instruções Passo a Passo */}
                  {(() => {
                    const preset = EMAIL_PRESETS.find((p) => p.id === smtpProvider) || EMAIL_PRESETS[0];
                    return (
                      <div className="p-4 rounded-2xl bg-gradient-to-r from-blue-950/20 via-[#0e1626]/40 to-transparent border border-blue-500/20 text-xs space-y-2">
                        <div className="flex items-center gap-2 text-blue-300 font-semibold">
                          <Info className="w-4 h-4 shrink-0 text-blue-400" />
                          <span>Orientação de Conexão Segura — {preset.name}</span>
                        </div>
                        <p className="text-neutral-300 text-xs leading-relaxed pl-6">
                          {preset.helpTip}
                        </p>
                        {preset.stepByStep && preset.stepByStep.length > 0 && (
                          <div className="pl-6 pt-1">
                            <ol className="list-decimal list-inside space-y-1 text-[11px] text-neutral-400">
                              {preset.stepByStep.map((step, idx) => (
                                <li key={idx}>
                                  <span className="text-neutral-300">{step}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* 3. Formulário de Credenciais e Servidor */}
                  <form onSubmit={handleSaveSmtp} className="space-y-5 pt-2">
                    {smtpProvider === "resend" ? (
                      /* Formulário para Resend (API) */
                      <div>
                        <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center justify-between">
                          <span>Chave de API do Resend</span>
                          {hasSavedPassword && (
                            <span className="text-[11px] text-emerald-400 flex items-center gap-1 font-mono">
                              <Lock className="w-3 h-3" /> Chave gravada no cofre
                            </span>
                          )}
                        </label>
                        <div className="relative">
                          <input
                            type={showSmtpApiKey ? "text" : "password"}
                            value={smtpApiKey}
                            onChange={(e) => setSmtpApiKey(e.target.value)}
                            placeholder={hasSavedPassword ? "••••••••••••••••••••••••••••••••" : "re_xxxxxxxxxxxxxxxxxxxxxxxxx"}
                            className="w-full px-3.5 py-2.5 pr-10 bg-[#150d0d] border border-white/[0.09] rounded-xl text-xs font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-[#7d0000]"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSmtpApiKey(!showSmtpApiKey)}
                            className="absolute right-3 top-2.5 text-neutral-500 hover:text-white"
                          >
                            {showSmtpApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Formulário para Provedores SMTP/IMAP (Gmail, Outlook, Zoho, Hostinger, Locaweb, Umbler, cPanel, Custom) */
                      <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                              Usuário / E-mail da Conta
                            </label>
                            <input
                              type="text"
                              value={smtpUser}
                              onChange={(e) => setSmtpUser(e.target.value)}
                              placeholder={`contato@${currentDomain.domainName}`}
                              className="w-full px-3.5 py-2.5 bg-[#150d0d] border border-white/[0.09] rounded-xl text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-[#7d0000]"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-neutral-300 mb-1.5 flex items-center justify-between">
                              <span>Senha ou Senha de App</span>
                              {hasSavedPassword && (
                                <span className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
                                  <Lock className="w-2.5 h-2.5" /> Senha salva
                                </span>
                              )}
                            </label>
                            <div className="relative">
                              <input
                                type={showSmtpPass ? "text" : "password"}
                                value={smtpPass}
                                onChange={(e) => setSmtpPass(e.target.value)}
                                placeholder={hasSavedPassword ? "••••••••••••••••" : "Senha corporativa ou de app"}
                                className="w-full px-3.5 py-2.5 pr-10 bg-[#150d0d] border border-white/[0.09] rounded-xl text-xs font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-[#7d0000]"
                              />
                              <button
                                type="button"
                                onClick={() => setShowSmtpPass(!showSmtpPass)}
                                className="absolute right-3 top-2.5 text-neutral-500 hover:text-white"
                              >
                                {showSmtpPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Status de Criptografia & Botão de Ajustes Avançados */}
                        <div className="p-3 bg-[#140d0d] border border-white/[0.07] rounded-xl flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-400">🛡️</span>
                            <span className="text-neutral-300 font-medium">
                              {smtpSecure ? "Porta 465 (SSL Criptografado Nativo)" : "Porta 587 (TLS com STARTTLS)"}
                            </span>
                            <span className="text-neutral-500 font-mono text-[11px]">
                              ({smtpHost || `mail.${currentDomain.domainName}`}:{smtpPort})
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => setShowAdvancedSmtp(!showAdvancedSmtp)}
                            className="text-[11px] text-neutral-400 hover:text-white flex items-center gap-1 transition cursor-pointer"
                          >
                            <span>Ajustes Técnicos de Host/Porta</span>
                            {showAdvancedSmtp ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </div>

                        {/* Painel Avançado de Host, Porta e IMAP (Opcional para quem precisa de proxy ou customização) */}
                        {showAdvancedSmtp && (
                          <div className="p-4 rounded-2xl bg-[#0a0505] border border-white/[0.09] space-y-4">
                            <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider flex items-center gap-1.5">
                              <Server className="w-3.5 h-3.5 text-neutral-400" />
                              <span>Configurações Detalhadas de Envio (SMTP) & Leitura (IMAP)</span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div className="sm:col-span-2">
                                <label className="block text-[11px] font-semibold text-neutral-400 mb-1">
                                  Host do Servidor SMTP
                                </label>
                                <input
                                  type="text"
                                  value={smtpHost}
                                  onChange={(e) => setSmtpHost(e.target.value)}
                                  placeholder="smtp.seudominio.com"
                                  className="w-full px-3 py-2 bg-[#150d0d] border border-white/[0.08] rounded-xl text-xs text-white font-mono focus:outline-none focus:border-[#7d0000]"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] font-semibold text-neutral-400 mb-1">
                                  Porta SMTP
                                </label>
                                <input
                                  type="number"
                                  value={smtpPort}
                                  onChange={(e) => setSmtpPort(e.target.value)}
                                  placeholder="465"
                                  className="w-full px-3 py-2 bg-[#150d0d] border border-white/[0.08] rounded-xl text-xs text-white font-mono focus:outline-none focus:border-[#7d0000]"
                                />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div className="sm:col-span-2">
                                <label className="block text-[11px] font-semibold text-neutral-400 mb-1">
                                  Host do Servidor IMAP (Recebimento)
                                </label>
                                <input
                                  type="text"
                                  value={imapHost}
                                  onChange={(e) => setImapHost(e.target.value)}
                                  placeholder="imap.seudominio.com"
                                  className="w-full px-3 py-2 bg-[#150d0d] border border-white/[0.08] rounded-xl text-xs text-white font-mono focus:outline-none focus:border-[#7d0000]"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] font-semibold text-neutral-400 mb-1">
                                  Porta IMAP
                                </label>
                                <input
                                  type="number"
                                  value={imapPort}
                                  onChange={(e) => setImapPort(e.target.value)}
                                  placeholder="993"
                                  className="w-full px-3 py-2 bg-[#150d0d] border border-white/[0.08] rounded-xl text-xs text-white font-mono focus:outline-none focus:border-[#7d0000]"
                                />
                              </div>
                            </div>

                            <div className="flex items-center gap-4 text-xs text-neutral-300">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={smtpSecure}
                                  onChange={(e) => setSmtpSecure(e.target.checked)}
                                  className="rounded border-white/20 bg-neutral-900 text-red-600 focus:ring-0"
                                />
                                <span>Exigir SSL Direto (Porta 465)</span>
                              </label>

                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={imapSecure}
                                  onChange={(e) => setImapSecure(e.target.checked)}
                                  className="rounded border-white/20 bg-neutral-900 text-red-600 focus:ring-0"
                                />
                                <span>IMAP com SSL (Porta 993)</span>
                              </label>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Dados do Remetente Padrão */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                      <div>
                        <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                          Nome de Exibição do Remetente
                        </label>
                        <input
                          type="text"
                          value={smtpFromName}
                          onChange={(e) => setSmtpFromName(e.target.value)}
                          placeholder="Ex: Atendimento Corporativo"
                          className="w-full px-3.5 py-2.5 bg-[#150d0d] border border-white/[0.09] rounded-xl text-xs text-white focus:outline-none focus:border-[#7d0000]"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                          E-mail Padrão de Disparo
                        </label>
                        <input
                          type="email"
                          value={smtpFromEmail}
                          onChange={(e) => setSmtpFromEmail(e.target.value)}
                          placeholder={`contato@${currentDomain.domainName}`}
                          className="w-full px-3.5 py-2.5 bg-[#150d0d] border border-white/[0.09] rounded-xl text-xs text-white focus:outline-none focus:border-[#7d0000]"
                        />
                      </div>
                    </div>

                    {/* Mensagens de Feedback */}
                    {smtpSaveResult && (
                      <div
                        className={`p-3.5 rounded-xl text-xs flex items-center gap-2.5 ${
                          smtpSaveResult.ok
                            ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-300"
                            : "bg-red-500/10 border border-red-500/25 text-red-300"
                        }`}
                      >
                        {smtpSaveResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" /> : <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />}
                        <span>{smtpSaveResult.message}</span>
                      </div>
                    )}

                    {smtpTestResult && (
                      <div
                        className={`p-3.5 rounded-xl text-xs flex items-center gap-2.5 ${
                          smtpTestResult.ok
                            ? "bg-emerald-500/10 border border-emerald-500/25 text-emerald-300"
                            : "bg-red-500/10 border border-red-500/25 text-red-300"
                        }`}
                      >
                        {smtpTestResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" /> : <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />}
                        <span className="leading-relaxed">{smtpTestResult.message}</span>
                      </div>
                    )}

                    {/* 4. Barra de Ações: Salvar e Testes Live */}
                    <div className="pt-2 border-t border-white/[0.06] space-y-3">
                      <div className="flex flex-col sm:flex-row gap-3">
                        <button
                          type="button"
                          onClick={() => handleTestSmtp(false)}
                          disabled={isTestingSmtp || isSendingTestEmail}
                          className="px-4 py-2.5 rounded-xl border border-white/[0.1] hover:bg-white/[0.04] text-xs font-semibold text-neutral-300 transition cursor-pointer flex items-center justify-center gap-2"
                        >
                          {isTestingSmtp ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Radio className="w-3.5 h-3.5 text-blue-400" />}
                          <span>Testar Conexão Ao Vivo</span>
                        </button>

                        <button
                          type="submit"
                          disabled={isSavingSmtp}
                          className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-[#7d0000] to-[#990000] hover:from-[#900000] hover:to-[#b30000] text-white text-xs font-semibold shadow-md shadow-red-950/40 transition cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {isSavingSmtp ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Salvando Configuração...</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-4 h-4" />
                              <span>Salvar Configuração do Provedor</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Opção de Disparo de E-mail de Teste Real */}
                      <div className="p-3.5 rounded-2xl bg-[#140d0d] border border-white/[0.06] flex flex-col sm:flex-row items-center gap-3">
                        <div className="flex items-center gap-2 shrink-0">
                          <Send className="w-3.5 h-3.5 text-neutral-400" />
                          <span className="text-xs text-neutral-300 font-semibold">Disparar E-mail de Teste:</span>
                        </div>

                        <input
                          type="email"
                          value={testEmailAddress}
                          onChange={(e) => setTestEmailAddress(e.target.value)}
                          placeholder={user?.email || `seu-email-pessoal@gmail.com`}
                          className="flex-1 px-3 py-2 bg-[#0c0808] border border-white/[0.08] rounded-xl text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-[#7d0000]"
                        />

                        <button
                          type="button"
                          onClick={() => handleTestSmtp(true)}
                          disabled={isSendingTestEmail || isTestingSmtp}
                          className="px-4 py-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                        >
                          {isSendingTestEmail ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3 h-3" />}
                          <span>Enviar Teste</span>
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* ========================================================== */}
            {/* ========================================================== */}
            {/* TAB 4: CARTÓRIO ON-CHAIN                                   */}
            {/* ========================================================== */}
            {activeTab === "onchain" && (
              <div className="space-y-6">
                {/* Alerta Nuclear de Suspensão por Strikes / Saldo Esgotado */}
                {domainEconomics?.isSuspended && (
                  <div className="bg-red-950/40 border border-red-500/50 rounded-3xl p-6 shadow-2xl space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-6 h-6 text-red-400 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-sm font-bold text-red-200">
                            🚨 Domínio Suspenso pela Rede (Nuclear Option Ativado)
                          </h4>
                          <p className="text-xs text-neutral-300 mt-1 leading-relaxed">
                            O domínio acumulou infrações críticas ou saldo de caução esgotado por strikes de spam/violação de handshake semântico. Novos disparos P2P e SMTP estão temporariamente bloqueados pelo Gateway para proteção da reputação da rede MAIVW.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsTopUpOpen(true)}
                        className="px-4 py-2 bg-gradient-to-r from-red-600 to-rose-700 hover:from-red-500 hover:to-rose-600 text-white rounded-xl text-xs font-bold shadow-lg transition shrink-0 cursor-pointer flex items-center gap-1.5"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Recarregar &amp; Reativar</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Container Principal: Menu Lateral (Desktop) + Conteúdo */}
                <div className="flex flex-col lg:flex-row gap-6 items-start">
                  {/* Menu Lateral / Mobile Scrollable Pills */}
                  <div className="w-full lg:w-64 shrink-0 bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl p-3 shadow-xl">
                    <div className="px-3 py-2 border-b border-white/[0.06] mb-2 hidden lg:block">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
                        Configurações do Cartório
                      </span>
                    </div>

                    <div className="flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0 scrollbar-none">
                      {/* Sub-tab 1: Visão Geral */}
                      <button
                        type="button"
                        onClick={() => setOnchainSubTab("overview")}
                        className={`w-full text-left px-3.5 py-3 rounded-2xl text-xs font-semibold transition flex items-center justify-between cursor-pointer whitespace-nowrap ${
                          onchainSubTab === "overview"
                            ? "bg-[#7d0000] text-white shadow-lg shadow-red-950/40"
                            : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
                          <span>Visão Geral</span>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            onchainSubTab === "overview"
                              ? "bg-white/20 text-white"
                              : "bg-white/[0.06] text-neutral-400"
                          }`}
                        >
                          {currentDomain.originFamily === "SOLANA" ? "Solana" : "Base"}
                        </span>
                      </button>

                      {/* Sub-tab 2: Presença Multi-Chain */}
                      <button
                        type="button"
                        onClick={() => setOnchainSubTab("multichain")}
                        className={`w-full text-left px-3.5 py-3 rounded-2xl text-xs font-semibold transition flex items-center justify-between cursor-pointer whitespace-nowrap ${
                          onchainSubTab === "multichain"
                            ? "bg-[#7d0000] text-white shadow-lg shadow-red-950/40"
                            : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Network className="w-4 h-4 shrink-0 text-blue-400" />
                          <span>Multi-Chain</span>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            onchainSubTab === "multichain"
                              ? "bg-white/20 text-white"
                              : "bg-white/[0.06] text-neutral-400"
                          }`}
                        >
                          Cross-Ledger
                        </span>
                      </button>

                      {/* Sub-tab 3: Segurança & Inbound */}
                      <button
                        type="button"
                        onClick={() => setOnchainSubTab("security")}
                        className={`w-full text-left px-3.5 py-3 rounded-2xl text-xs font-semibold transition flex items-center justify-between cursor-pointer whitespace-nowrap ${
                          onchainSubTab === "security"
                            ? "bg-[#7d0000] text-white shadow-lg shadow-red-950/40"
                            : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Shield className="w-4 h-4 shrink-0 text-indigo-400" />
                          <span>Segurança &amp; Inbound</span>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            onchainSubTab === "security"
                              ? "bg-white/20 text-white"
                              : "bg-white/[0.06] text-neutral-400"
                          }`}
                        >
                          Presets P2P
                        </span>
                      </button>

                      {/* Sub-tab 4: Governança & Tiers */}
                      <button
                        type="button"
                        onClick={() => setOnchainSubTab("governance")}
                        className={`w-full text-left px-3.5 py-3 rounded-2xl text-xs font-semibold transition flex items-center justify-between cursor-pointer whitespace-nowrap ${
                          onchainSubTab === "governance"
                            ? "bg-[#7d0000] text-white shadow-lg shadow-red-950/40"
                            : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Coins className="w-4 h-4 shrink-0 text-amber-400" />
                          <span>Governança &amp; Tiers</span>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                            onchainSubTab === "governance"
                              ? "bg-white/20 text-white"
                              : "bg-white/[0.06] text-neutral-400"
                          }`}
                        >
                          Cotas
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Painel de Conteúdo de cada Sub-aba */}
                  <div className="flex-1 w-full space-y-6 min-w-0">
                    {/* ======================================================== */}
                    {/* SUB-TAB 1: VISÃO GERAL ON-CHAIN                          */}
                    {/* ======================================================== */}
                    {onchainSubTab === "overview" && (
                      <div className="space-y-6">
                        <div className="bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl p-6 md:p-8 shadow-xl space-y-6">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-white/[0.06] gap-4">
                            <div>
                              <h3 className="text-base font-bold text-white flex items-center gap-2">
                                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                                <span>Atestado no Cartório Descentralizado</span>
                              </h3>
                              <p className="text-xs text-neutral-400 mt-1">
                                A titularidade deste domínio foi comprovada via DNS TXT e ancorada na blockchain com prova criptográfica permanente.
                              </p>
                            </div>

                            {currentDomain.originFamily === "SOLANA" ? (
                              <a
                                href={
                                  currentDomain.explorerUrl ||
                                  "https://explorer.solana.com/address/Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS?cluster=devnet"
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="px-3.5 py-1.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shrink-0 self-start sm:self-auto"
                              >
                                <span>Ver no Solana Explorer</span>
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            ) : (
                              <a
                                href={
                                  currentDomain.explorerUrl ||
                                  `https://sepolia.basescan.org/address/${runtimePublicValue('NEXT_PUBLIC_REGISTRY_CONTRACT_ADDRESS') || "0x0000000000000000000000000000000000000000"}`
                                }
                                target="_blank"
                                rel="noreferrer"
                                className="px-3.5 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 text-blue-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shrink-0 self-start sm:self-auto"
                              >
                                <span>Ver no BaseScan</span>
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                            <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl">
                              <span className="text-neutral-400 block text-[11px] mb-1">Rede de Ancoragem (Origem):</span>
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${currentDomain.originFamily === "SOLANA" ? "bg-purple-400" : "bg-emerald-400"} animate-pulse`} />
                                <span className="font-bold text-white">
                                  {currentDomain.originNetworkName || (currentDomain.originFamily === "SOLANA" ? "Solana Devnet" : "Base Sepolia (Chain ID 84532)")}
                                </span>
                              </div>
                            </div>

                            <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl">
                              <span className="text-neutral-400 block text-[11px] mb-1">Família Criptográfica:</span>
                              <span className="font-bold text-white">
                                {currentDomain.originFamily === "SOLANA"
                                  ? "Ed25519 (Solana PDA / Curve25519)"
                                  : "ECDSA secp256k1 (Ethereum Standard)"}
                              </span>
                            </div>

                            <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl">
                              <span className="text-neutral-400 block text-[11px] mb-1">Score de Reputação:</span>
                              <span className="font-bold text-emerald-400">100 / 100 (Impecável • Sem strikes)</span>
                            </div>

                            <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl">
                              <span className="text-neutral-400 block text-[11px] mb-1">Status de Verificação:</span>
                              <span className="font-bold text-emerald-400 flex items-center gap-1.5">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>DNS TXT Verificado • Ativo</span>
                              </span>
                            </div>

                            <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl sm:col-span-2">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-neutral-400 text-[11px]">
                                  {currentDomain.originFamily === "SOLANA"
                                    ? "Chave Pública Solana (KMS / PDA Authority):"
                                    : "Chave Pública da Carteira (KMS):"}
                                </span>
                                <span className="text-[10px] text-neutral-500">
                                  Assinatura Criptográfica P2P
                                </span>
                              </div>
                              <div className="flex items-center justify-between font-mono text-neutral-200">
                                <span className="truncate">{currentDomain.publicKey || "Chave KMS vinculada"}</span>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(currentDomain.publicKey || "", "wallet_key")}
                                  className="p-1 hover:text-white transition ml-2 cursor-pointer"
                                  title="Copiar Chave Pública"
                                >
                                  {copiedKey === "wallet_key" ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Explicação de Autenticação */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                          <div className="p-5 bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl space-y-2">
                            <div className="flex items-center gap-2 text-white font-bold">
                              <Lock className="w-4 h-4 text-indigo-400" />
                              <span>Imutabilidade On-Chain</span>
                            </div>
                            <p className="text-neutral-400 leading-relaxed text-[11px]">
                              Todos os gateways federados MAIVW consultam este registro para autenticar conexões SMTP sem requerer autoridade central de certificação, garantindo total soberania.
                            </p>
                          </div>

                          <div className="p-5 bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl space-y-2">
                            <div className="flex items-center gap-2 text-white font-bold">
                              <Network className="w-4 h-4 text-blue-400" />
                              <span>Interoperabilidade Multi-Chain</span>
                            </div>
                            <p className="text-neutral-400 leading-relaxed text-[11px]">
                              Sua identidade criptográfica na rede {currentDomain.originNetworkName || (currentDomain.originFamily === "SOLANA" ? "Solana" : "Base")} pode ser estendida para outras blockchains através da aba <strong>Multi-Chain</strong>.
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ======================================================== */}
                    {/* SUB-TAB 2: PRESENÇA MULTI-CHAIN & ESPELHAMENTO           */}
                    {/* ======================================================== */}
                    {onchainSubTab === "multichain" && (
                      <div className="space-y-6">
                        <div className="bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl p-6 md:p-8 shadow-xl space-y-6">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-white/[0.06] gap-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <Network className="w-5 h-5 text-blue-400" />
                                <h3 className="text-base font-bold text-white">
                                  Presença Multi-Chain &amp; Espelhamento
                                </h3>
                                <span className="px-2.5 py-0.5 text-[11px] font-bold tracking-wide rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30">
                                  Cross-Ledger
                                </span>
                              </div>
                              <p className="text-xs text-neutral-400 mt-1">
                                Espelhe seu domínio entre redes blockchain (Solana e EVM). Gateways em outras redes verificarão suas mensagens nativamente sem depender de pontes ou DNS centralizado.
                              </p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <Link
                                href="/admin/multichain"
                                className="px-3.5 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition"
                              >
                                <Network className="w-3.5 h-3.5" />
                                <span>Painel Completo</span>
                              </Link>
                              <button
                                type="button"
                                onClick={() => currentDomain && loadMultiChainStatus(currentDomain.domainName)}
                                disabled={isLoadingMultiChain}
                                className="px-3.5 py-1.5 bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.1] text-neutral-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                              >
                                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingMultiChain ? "animate-spin text-blue-400" : ""}`} />
                                <span>Atualizar</span>
                              </button>
                            </div>
                          </div>

                          {mirrorError && (
                            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-300">
                              <AlertCircle className="w-4 h-4 shrink-0" />
                              <span>{mirrorError}</span>
                            </div>
                          )}

                          {/* Grid das Redes Suportadas */}
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            {(
                              multiChainData?.networks ||
                              (currentDomain.originFamily === "SOLANA"
                                ? [
                                    {
                                      id: "solana-devnet",
                                      name: "Solana Devnet",
                                      symbol: "SOL",
                                      isPrimary: true,
                                      mirrorFeeFormatted: "0.05 SOL",
                                      status: "ACTIVE_PRIMARY",
                                      isActive: true,
                                      isOrigin: true,
                                      explorerUrl: currentDomain.explorerUrl || "https://explorer.solana.com/address/Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS?cluster=devnet",
                                    },
                                    {
                                      id: 84532,
                                      name: "Base Sepolia",
                                      symbol: "ETH",
                                      isPrimary: false,
                                      mirrorFeeFormatted: "0.003 ETH",
                                      status: "NOT_MIRRORED",
                                      isActive: false,
                                      isOrigin: false,
                                      explorerUrl: "https://sepolia.basescan.org/address/0x0000000000000000000000000000000000000000",
                                    },
                                    {
                                      id: 421614,
                                      name: "Arbitrum Sepolia",
                                      symbol: "ETH",
                                      isPrimary: false,
                                      mirrorFeeFormatted: "0.003 ETH",
                                      status: "NOT_MIRRORED",
                                      isActive: false,
                                      isOrigin: false,
                                    },
                                    {
                                      id: 80002,
                                      name: "Polygon Amoy",
                                      symbol: "POL",
                                      isPrimary: false,
                                      mirrorFeeFormatted: "25 POL",
                                      status: "NOT_MIRRORED",
                                      isActive: false,
                                      isOrigin: false,
                                    },
                                  ]
                                : [
                                    {
                                      id: 84532,
                                      name: "Base Sepolia",
                                      symbol: "ETH",
                                      isPrimary: true,
                                      mirrorFeeFormatted: "0.003 ETH",
                                      status: "ACTIVE_PRIMARY",
                                      isActive: true,
                                      isOrigin: true,
                                      explorerUrl: "https://sepolia.basescan.org/address/0x0000000000000000000000000000000000000000",
                                    },
                                    {
                                      id: "solana-devnet",
                                      name: "Solana Devnet",
                                      symbol: "SOL",
                                      isPrimary: false,
                                      mirrorFeeFormatted: "0.05 SOL",
                                      status: "NOT_MIRRORED",
                                      isActive: false,
                                      isOrigin: false,
                                      explorerUrl: "https://explorer.solana.com/address/Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS?cluster=devnet",
                                    },
                                    {
                                      id: 421614,
                                      name: "Arbitrum Sepolia",
                                      symbol: "ETH",
                                      isPrimary: false,
                                      mirrorFeeFormatted: "0.003 ETH",
                                      status: "NOT_MIRRORED",
                                      isActive: false,
                                      isOrigin: false,
                                    },
                                    {
                                      id: 80002,
                                      name: "Polygon Amoy",
                                      symbol: "POL",
                                      isPrimary: false,
                                      mirrorFeeFormatted: "25 POL",
                                      status: "NOT_MIRRORED",
                                      isActive: false,
                                      isOrigin: false,
                                    },
                                  ])
                            ).map((net: any) => {
                              const isOrigin =
                                net.isOrigin ||
                                (net.isPrimary && !net.status?.includes("MIRRORED")) ||
                                (currentDomain.originFamily === "SOLANA" && (net.id === "solana-devnet" || net.name.includes("Solana")));
                              const isMirrored = net.status === "MIRRORED";
                              const isPending = attestingChainId === net.id;

                              return (
                                <div
                                  key={net.id}
                                  className={`p-4 rounded-2xl border flex flex-col justify-between transition-all ${
                                    isOrigin
                                      ? "bg-emerald-950/20 border-emerald-500/40"
                                      : isMirrored
                                      ? "bg-blue-950/20 border-blue-500/40"
                                      : "bg-black/40 border-white/[0.06] hover:border-white/20"
                                  }`}
                                >
                                  <div>
                                    <div className="flex items-center justify-between mb-2">
                                      <span className="font-bold text-white text-xs">{net.name}</span>
                                      {isOrigin ? (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                          Origem
                                        </span>
                                      ) : isMirrored ? (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center gap-1">
                                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                                          Espelhado
                                        </span>
                                      ) : (
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/[0.06] text-neutral-400 border border-white/[0.08]">
                                          Disponível
                                        </span>
                                      )}
                                    </div>

                                    <p className="text-[11px] text-neutral-400 mb-3 line-clamp-2">
                                      {net.id === "solana-devnet" || net.name.includes("Solana")
                                        ? "Rede Solana L1 • Alta velocidade e assinaturas Ed25519."
                                        : net.id === 84532
                                        ? "L2 Coinbase • Ancoragem Primária e liquidação EVM."
                                        : net.id === 421614
                                        ? "L2 Arbitrum Nitro • Alta velocidade para DeFi e finanças."
                                        : "PoS & AggLayer • Compatibilidade com ecossistema Polygon."}
                                    </p>

                                    <div className="text-[11px] space-y-1 py-2 border-t border-white/[0.04]">
                                      <div className="flex justify-between text-neutral-400">
                                        <span>Identificador:</span>
                                        <span className="font-mono text-neutral-300 font-semibold truncate max-w-[110px]" title={String(net.id)}>
                                          {net.id}
                                        </span>
                                      </div>
                                      <div className="flex justify-between text-neutral-400">
                                        <span>Taxa:</span>
                                        <span className="font-mono text-amber-400 font-semibold">
                                          {net.mirrorFeeFormatted || "~$10"}
                                        </span>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="pt-3 border-t border-white/[0.06] mt-2">
                                    {isOrigin ? (
                                      <div className="text-[11px] text-emerald-400 font-semibold flex items-center justify-center gap-1 py-1">
                                        <ShieldCheck className="w-3.5 h-3.5" />
                                        <span>Origem Primária Ativa</span>
                                      </div>
                                    ) : isMirrored ? (
                                      <div className="text-[11px] text-blue-400 font-semibold flex items-center justify-center gap-1 py-1">
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        <span>Espelho Sincronizado</span>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => handleOpenMirrorPayment(net)}
                                        disabled={isPending || isLoadingMultiChain}
                                        className="w-full py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-950/50 flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-95 disabled:opacity-50"
                                      >
                                        {isPending ? (
                                          <>
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                            <span>Atestando...</span>
                                          </>
                                        ) : (
                                          <>
                                            <Zap className="w-3.5 h-3.5" />
                                            <span>Ativar Espelho ($10)</span>
                                          </>
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Informações Regulatórias e Econômicas */}
                          <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl space-y-2 text-xs">
                            <div className="flex items-start gap-2 text-neutral-300">
                              <Shield className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
                              <div>
                                <strong className="text-white">Slashing Unificado em Todas as Redes:</strong> Em caso de violação grave de conteúdo (spam/spoofing) comprovada pelo Oráculo, o domínio é banido na cadeia de origem e todas as suas instâncias espelhadas são sumariamente desativadas via chamada autorizada on-chain.
                              </div>
                            </div>
                            <div className="flex items-start gap-2 text-neutral-300 pt-1 border-t border-white/[0.04]">
                              <Coins className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                              <div>
                                <strong className="text-white">Taxa 100% Repassada ao Oráculo:</strong> O valor de taxa é transferido integral e diretamente à carteira do Nó Validador para cobrir atestação criptográfica e custos operacionais cross-chain.
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ======================================================== */}
                    {/* SUB-TAB 3: POSTURA DE SEGURANÇA & INBOUND                */}
                    {/* ======================================================== */}
                    {onchainSubTab === "security" && (
                      <div className="space-y-6">
                        {/* 1. Diagnóstico de 3 Pilares */}
                        <div className="bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl p-6 md:p-8 shadow-xl space-y-6 relative overflow-hidden">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-white/[0.06] gap-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <Shield className="w-5 h-5 text-indigo-400" />
                                <h3 className="text-base font-bold text-white">
                                  Postura de Segurança &amp; Roteamento
                                </h3>
                                {securityMode === "public" && (
                                  <span className="px-2.5 py-0.5 text-[11px] font-bold tracking-wide rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                    Nível 1: Clear Web (Público)
                                  </span>
                                )}
                                {securityMode === "hybrid" && (
                                  <span className="px-2.5 py-0.5 text-[11px] font-bold tracking-wide rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                    ⚡ Modo Híbrido (Dual-Stack)
                                  </span>
                                )}
                                {securityMode === "dark" && (
                                  <span className="px-2.5 py-0.5 text-[11px] font-bold tracking-wide rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                    🛡️ Modo Dark Total (Nível 3/4)
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-neutral-400 mt-1">
                                Diagnóstico em tempo real da visibilidade na blockchain, camuflagem contra varreduras de portas e herança de subdomínios.
                              </p>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-neutral-500">Status:</span>
                              <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                Sincronizado
                              </span>
                            </div>
                          </div>

                          {/* Semáforo / Diagnóstico de 3 Pilares */}
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl">
                              <span className="text-neutral-400 block text-[11px] mb-1">1. Visibilidade na Blockchain:</span>
                              <div className="font-bold text-white flex items-center gap-1.5">
                                {securityMode === "dark" ? (
                                  <>
                                    <Lock className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                                    <span className="text-purple-300">Oculto ("PRIVATE")</span>
                                  </>
                                ) : (
                                  <>
                                    <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                    <span className="text-emerald-300 truncate" title={editingEndpoint}>{editingEndpoint || "https://..."}</span>
                                  </>
                                )}
                              </div>
                              <p className="text-[10px] text-neutral-500 mt-1">
                                {securityMode === "dark" ? "Nenhum IP ou URL exposto publicamente." : "Endpoint acessível via resolução on-chain."}
                              </p>
                            </div>

                            <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl">
                              <span className="text-neutral-400 block text-[11px] mb-1">2. Camuflagem do Gateway (Inbound):</span>
                              <div className="font-bold text-white flex items-center gap-1.5">
                                {securityMode === "dark" ? (
                                  <>
                                    <ShieldAlert className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                                    <span className="text-purple-300">Silent Drop 404 Estrito</span>
                                  </>
                                ) : securityMode === "hybrid" ? (
                                  <>
                                    <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                    <span className="text-amber-300">Porta Dupla (Público + VIP)</span>
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                    <span className="text-emerald-300">Recepção P2P Aberta</span>
                                  </>
                                )}
                              </div>
                              <p className="text-[10px] text-neutral-500 mt-1">
                                {securityMode === "dark"
                                  ? "Scanners e curiosos recebem 404 Not Found."
                                  : securityMode === "hybrid"
                                  ? "Clientes usam web aberta; bancos usam token VIP."
                                  : "Qualquer participante MAIVW pode entregar."}
                              </p>
                            </div>

                            <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl">
                              <span className="text-neutral-400 block text-[11px] mb-1">3. Herança de Subdomínios:</span>
                              <div className="font-bold text-white flex items-center gap-1.5">
                                <Layers className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                <span className="text-blue-300">Herança Wildcard Ativa</span>
                              </div>
                              <p className="text-[10px] text-neutral-500 mt-1">
                                E-mails como <code className="text-neutral-400">@*.{currentDomain?.domainName || "dominio"}</code> herdam estas regras sem custo extra.
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* 2. Painel de Configuração de Recepção (Inbound) */}
                        <div className="bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl p-6 md:p-8 shadow-xl space-y-6">
                          <div className="pb-4 border-b border-white/[0.06]">
                            <h3 className="text-base font-bold text-white flex items-center gap-2">
                              <Lock className="w-5 h-5 text-indigo-400" />
                              <span>Recepção de E-mails (Inbound): Escolha o Modo de Operação</span>
                            </h3>
                            <p className="text-xs text-neutral-400 mt-1">
                              Selecione como outros participantes da rede localizam e entregam mensagens para este domínio.
                            </p>
                          </div>

                          {/* 3 PRESETS CLICÁVEIS */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div
                              onClick={() => setSecurityMode("public")}
                              className={`p-4 rounded-2xl border cursor-pointer transition-all duration-200 ${
                                securityMode === "public"
                                  ? "bg-emerald-950/30 border-emerald-500/50 shadow-lg shadow-emerald-950/50 ring-1 ring-emerald-500/50"
                                  : "bg-black/30 border-white/[0.06] hover:border-white/20 hover:bg-white/[0.02]"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <Globe className={`w-4 h-4 ${securityMode === "public" ? "text-emerald-400" : "text-neutral-400"}`} />
                                  <h4 className="text-xs font-bold text-white">1. Modo Público</h4>
                                </div>
                                <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${securityMode === "public" ? "border-emerald-400 bg-emerald-400/20" : "border-neutral-600"}`}>
                                  {securityMode === "public" && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                                </div>
                              </div>
                              <p className="text-[11px] text-neutral-400 leading-relaxed">
                                Endpoint HTTPS publicado abertamente no Cartório. Ideal para empresas comerciais, e-commerces e SaaS.
                              </p>
                              <div className="mt-3 text-[10px] font-semibold text-emerald-400">
                                Nível 1 — Clear Web P2P
                              </div>
                            </div>

                            <div
                              onClick={() => setSecurityMode("hybrid")}
                              className={`p-4 rounded-2xl border cursor-pointer transition-all duration-200 ${
                                securityMode === "hybrid"
                                  ? "bg-amber-950/30 border-amber-500/50 shadow-lg shadow-amber-950/50 ring-1 ring-amber-500/50"
                                  : "bg-black/30 border-white/[0.06] hover:border-white/20 hover:bg-white/[0.02]"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <Zap className={`w-4 h-4 ${securityMode === "hybrid" ? "text-amber-400" : "text-neutral-400"}`} />
                                  <h4 className="text-xs font-bold text-white">2. Modo Híbrido</h4>
                                </div>
                                <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${securityMode === "hybrid" ? "border-amber-400 bg-amber-400/20" : "border-neutral-600"}`}>
                                  {securityMode === "hybrid" && <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                                </div>
                              </div>
                              <p className="text-[11px] text-neutral-400 leading-relaxed">
                                Dual-Stack: Recebe tráfego público de clientes e disponibiliza canal camuflado com Token VIP para bancos.
                              </p>
                              <div className="mt-3 text-[10px] font-semibold text-amber-400">
                                Nível 1 (Público) + Nível 3 (VIP)
                              </div>
                            </div>

                            <div
                              onClick={() => setSecurityMode("dark")}
                              className={`p-4 rounded-2xl border cursor-pointer transition-all duration-200 ${
                                securityMode === "dark"
                                  ? "bg-purple-950/30 border-purple-500/50 shadow-lg shadow-purple-950/50 ring-1 ring-purple-500/50"
                                  : "bg-black/30 border-white/[0.06] hover:border-white/20 hover:bg-white/[0.02]"
                              }`}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <Lock className={`w-4 h-4 ${securityMode === "dark" ? "text-purple-400" : "text-neutral-400"}`} />
                                  <h4 className="text-xs font-bold text-white">3. Modo Dark Total</h4>
                                </div>
                                <div className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${securityMode === "dark" ? "border-purple-400 bg-purple-400/20" : "border-neutral-600"}`}>
                                  {securityMode === "dark" && <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
                                </div>
                              </div>
                              <p className="text-[11px] text-neutral-400 leading-relaxed">
                                Invisível na rede. Gravado como "PRIVATE" on-chain. Silent Drop 404 para quem não tiver o token pré-compartilhado.
                              </p>
                              <div className="mt-3 text-[10px] font-semibold text-purple-400">
                                Nível 3 / 4 — Dark Endpoint
                              </div>
                            </div>
                          </div>

                          {/* Formulário de Configuração */}
                          <form onSubmit={handleApplySecurityMode} className="space-y-4 pt-2">
                            {(securityMode === "public" || securityMode === "hybrid") && (
                              <div>
                                <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                                  URL do Endpoint Público HTTPS (On-Chain):
                                </label>
                                <input
                                  type="text"
                                  required
                                  value={editingEndpoint}
                                  onChange={(e) => setEditingEndpoint(e.target.value)}
                                  placeholder="https://email.seudominio.com/api/v1/inbox"
                                  className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 font-mono focus:outline-none focus:border-indigo-500 transition"
                                />
                                <p className="text-[11px] text-neutral-500 mt-1">
                                  Endereço público onde gateways e provedores MAIVW entregam mensagens para este domínio.
                                </p>
                              </div>
                            )}

                            {securityMode === "dark" && (
                              <div className="p-4 bg-purple-950/20 border border-purple-500/30 rounded-2xl space-y-1">
                                <div className="flex items-center gap-2 text-xs font-bold text-purple-300">
                                  <ShieldCheck className="w-4 h-4 text-purple-400" />
                                  <span>Endereço Oculto na Blockchain</span>
                                </div>
                                <p className="text-[11px] text-neutral-300 leading-relaxed">
                                  Ao aplicar o Modo Dark, o registro no contrato inteligente será automaticamente atualizado para <code className="text-purple-300 font-mono">PRIVATE</code>. Nenhuma URL ou IP público será visível na blockchain.
                                </p>
                              </div>
                            )}

                            {(securityMode === "hybrid" || securityMode === "dark") && (
                              <div className="pt-2">
                                <div className="flex items-center justify-between mb-1.5">
                                  <label className="block text-xs font-semibold text-neutral-300">
                                    {securityMode === "hybrid"
                                      ? "Token de Autenticação do Canal VIP (Opcional para tráfego restrito):"
                                      : "Token Obrigatório de Acesso Inbound (x-maivw-stealth-token):"}
                                  </label>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={generateRandomToken}
                                      className="text-[11px] text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1 cursor-pointer"
                                    >
                                      <Sparkles className="w-3 h-3" />
                                      <span>Gerar Chave Segura</span>
                                    </button>
                                    {stealthConfig.inboundToken && (
                                      <button
                                        type="button"
                                        onClick={() => copyToClipboard(stealthConfig.inboundToken, "inbound_token")}
                                        className="text-[11px] text-neutral-400 hover:text-white transition flex items-center gap-1 cursor-pointer ml-2"
                                      >
                                        {copiedKey === "inbound_token" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                        <span>Copiar</span>
                                      </button>
                                    )}
                                  </div>
                                </div>

                                <input
                                  type="text"
                                  value={stealthConfig.inboundToken}
                                  onChange={(e) =>
                                    setStealthConfig((prev) => ({ ...prev, inboundToken: e.target.value }))
                                  }
                                  placeholder="Ex: maivw_st_8f3a129d4c7b8e10..."
                                  className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 font-mono focus:outline-none focus:border-indigo-500 transition"
                                />
                                <p className="text-[11px] text-neutral-500 mt-1">
                                  {securityMode === "dark"
                                    ? "Remetentes devem incluir este token no cabeçalho x-maivw-stealth-token. Requisições sem o token sofrem Silent Drop (404)."
                                    : "Compartilhe este token apenas com bancos e parceiros VIP para tratamento prioritário e seguro."}
                                </p>
                              </div>
                            )}

                            <div className="pt-3 border-t border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <label className="flex items-center gap-2.5 text-xs text-neutral-300 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={syncOnChain}
                                  onChange={(e) => setSyncOnChain(e.target.checked)}
                                  className="w-4 h-4 rounded bg-black/60 border-white/20 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span>
                                  Sincronizar e gravar alteração automaticamente no registro on-chain (
                                  {currentDomain.originNetworkName ||
                                    (currentDomain.originFamily === "SOLANA" ? "Solana Devnet" : "Base Sepolia")}
                                  )
                                </span>
                              </label>

                              <button
                                type="submit"
                                disabled={isSavingStealth}
                                className="px-6 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-700 hover:from-indigo-500 hover:to-purple-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-lg transition flex items-center justify-center gap-2 cursor-pointer shrink-0"
                              >
                                {isSavingStealth ? (
                                  <>
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    <span>Aplicando Postura...</span>
                                  </>
                                ) : (
                                  <>
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                    <span>Salvar Postura de Segurança</span>
                                  </>
                                )}
                              </button>
                            </div>

                            {stealthSaveMsg && (
                              <div
                                className={`p-3.5 rounded-xl border text-xs flex items-center gap-2.5 ${
                                  stealthSaveMsg.ok
                                    ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-300"
                                    : "bg-red-950/40 border-red-500/30 text-red-300"
                                }`}
                              >
                                {stealthSaveMsg.ok ? (
                                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                                ) : (
                                  <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                                )}
                                <span>{stealthSaveMsg.message}</span>
                              </div>
                            )}
                          </form>
                        </div>

                        {/* 3. Card: Rotas Privadas Bilaterais (Outbound Stealth) */}
                        <div className="bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl p-6 md:p-8 shadow-xl space-y-6">
                          <div className="flex items-center justify-between pb-4 border-b border-white/[0.06]">
                            <div>
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <h3 className="text-base font-bold text-white flex items-center gap-2">
                                  <Route className="w-5 h-5 text-blue-400" />
                                  <span>Tabela de Rotas Privadas Bilaterais (Outbound)</span>
                                </h3>
                                <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-bold">
                                  Opcional em Todos os Níveis • Apenas para Saída
                                </span>
                              </div>
                              <p className="text-xs text-neutral-400">
                                Agenda de destinos particulares para quando sua empresa precisa <strong>enviar e-mails para bancos, órgãos governamentais ou parceiros em Modo Dark</strong> que não publicam seus endpoints na blockchain. Se você apenas conversa com domínios públicos, <strong>deixe esta tabela vazia</strong> (o Gateway consultará o Cartório On-Chain automaticamente).
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => loadPrivateRoutes()}
                              disabled={isLoadingRoutes}
                              className="p-2 hover:bg-white/[0.05] rounded-xl text-neutral-400 hover:text-white transition"
                              title="Recarregar rotas"
                            >
                              <RefreshCw className={`w-4 h-4 ${isLoadingRoutes ? "animate-spin text-blue-400" : ""}`} />
                            </button>
                          </div>

                          {/* Lista de Rotas Cadastradas */}
                          <div className="space-y-3">
                            {privateRoutes.length === 0 ? (
                              <div className="p-5 text-center bg-black/40 border border-white/[0.04] rounded-2xl text-xs text-neutral-500">
                                Nenhuma rota privada bilateral configurada. Mensagens para domínios externos resolverão os endpoints cadastrados publicamente no Smart Contract.
                              </div>
                            ) : (
                              <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                  <thead>
                                    <tr className="border-b border-white/[0.06] text-neutral-400">
                                      <th className="pb-2.5 font-semibold">Domínio Alvo</th>
                                      <th className="pb-2.5 font-semibold">Endpoint Privado / VPN</th>
                                      <th className="pb-2.5 font-semibold">Auth Token</th>
                                      <th className="pb-2.5 font-semibold">Notas</th>
                                      <th className="pb-2.5 text-right font-semibold">Ação</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-white/[0.04]">
                                    {privateRoutes.map((r) => (
                                      <tr key={r.targetDomain} className="hover:bg-white/[0.02] transition">
                                        <td className="py-3 font-bold text-white">
                                          {r.targetDomain}
                                        </td>
                                        <td className="py-3 font-mono text-blue-400 max-w-xs truncate" title={r.privateEndpointUrl}>
                                          {r.privateEndpointUrl}
                                        </td>
                                        <td className="py-3 font-mono text-neutral-400">
                                          {r.stealthToken ? "••••••••" : "Nenhum"}
                                        </td>
                                        <td className="py-3 text-neutral-400 max-w-[150px] truncate" title={r.notes || ""}>
                                          {r.notes || "—"}
                                        </td>
                                        <td className="py-3 text-right">
                                          <button
                                            type="button"
                                            onClick={() => handleDeletePrivateRoute(r.targetDomain)}
                                            className="p-1.5 hover:bg-red-500/10 text-neutral-500 hover:text-red-400 rounded-lg transition cursor-pointer"
                                            title="Excluir rota privada"
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>

                          {/* Formulário: Adicionar Nova Rota Privada */}
                          <div className="pt-4 border-t border-white/[0.06]">
                            <h4 className="text-xs font-bold text-neutral-200 mb-3 flex items-center gap-1.5">
                              <Plus className="w-3.5 h-3.5 text-blue-400" />
                              <span>Cadastrar Nova Rota Privada Bilateral</span>
                            </h4>

                            <form onSubmit={handleAddPrivateRoute} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[11px] text-neutral-400 mb-1">
                                  Domínio Destinatário (ex: bacen.gov.br):
                                </label>
                                <input
                                  type="text"
                                  required
                                  value={newTargetDomain}
                                  onChange={(e) => setNewTargetDomain(e.target.value)}
                                  placeholder="bacen.gov.br"
                                  className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] text-neutral-400 mb-1">
                                  Endpoint Privado / VPN / Intranet:
                                </label>
                                <input
                                  type="url"
                                  required
                                  value={newPrivateUrl}
                                  onChange={(e) => setNewPrivateUrl(e.target.value)}
                                  placeholder="https://10.0.4.5:3001/api/v1/inbox"
                                  className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 font-mono focus:outline-none focus:border-blue-500 transition"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] text-neutral-400 mb-1">
                                  Token de Inbound (Opcional):
                                </label>
                                <input
                                  type="text"
                                  value={newStealthToken}
                                  onChange={(e) => setNewStealthToken(e.target.value)}
                                  placeholder="Token bilateral fornecido pelo receptor"
                                  className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 font-mono focus:outline-none focus:border-blue-500 transition"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] text-neutral-400 mb-1">
                                  Observações / Protocolo:
                                </label>
                                <input
                                  type="text"
                                  value={newRouteNotes}
                                  onChange={(e) => setNewRouteNotes(e.target.value)}
                                  placeholder="Ex: Canal Dedicado SPB / Banco Central"
                                  className="w-full bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition"
                                />
                              </div>

                              <div className="sm:col-span-2 flex items-center justify-between pt-1">
                                <button
                                  type="submit"
                                  disabled={isAddingRoute || !newTargetDomain.trim() || !newPrivateUrl.trim()}
                                  className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-500 hover:to-indigo-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-lg transition flex items-center gap-2 cursor-pointer"
                                >
                                  {isAddingRoute ? (
                                    <>
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                      <span>Cadastrando...</span>
                                    </>
                                  ) : (
                                    <>
                                      <Plus className="w-3.5 h-3.5" />
                                      <span>Adicionar Rota Bilateral</span>
                                    </>
                                  )}
                                </button>

                                {routeMsg && (
                                  <span className={`text-xs ${routeMsg.ok ? "text-emerald-400" : "text-red-400"}`}>
                                    {routeMsg.message}
                                  </span>
                                )}
                              </div>
                            </form>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ======================================================== */}
                    {/* SUB-TAB 4: GOVERNANÇA & TIERS                            */}
                    {/* ======================================================== */}
                    {onchainSubTab === "governance" && (
                      <div className="space-y-6">
                        <div className="bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl p-6 md:p-8 shadow-xl space-y-6">
                          <div className="flex items-center justify-between pb-4 border-b border-white/[0.06]">
                            <div>
                              <h3 className="text-base font-bold text-white flex items-center gap-2">
                                <Coins className="w-5 h-5 text-amber-400" />
                                <span>Modelo de Governança &amp; Tiers Operacionais</span>
                              </h3>
                              <p className="text-xs text-neutral-400 mt-1">
                                Parâmetros operacionais de capacidade diária, reputação e limites da infraestrutura.
                              </p>
                            </div>

                            {/* Botão de recarga se for autogovernado */}
                            {(domainEconomics as any)?.isSelfGoverned && (
                              <button
                                type="button"
                                onClick={() => setIsTopUpOpen(true)}
                                className="px-3.5 py-1.5 bg-[#7d0000]/20 hover:bg-[#7d0000]/40 border border-[#7d0000]/40 text-red-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Recarregar Saldo</span>
                              </button>
                            )}
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                            <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl">
                              <span className="text-neutral-400 block text-[11px] mb-1">Tier Operacional:</span>
                              <span className="font-bold text-white">
                                {domainEconomics
                                  ? domainEconomics.tier === 1
                                    ? "Tier 1: Startup SaaS (50k msgs/dia)"
                                    : domainEconomics.tier === 2
                                    ? "Tier 2: Growth ESP (1M msgs/dia)"
                                    : domainEconomics.tier === 3
                                    ? "Tier 3: Enterprise (Ilimitado)"
                                    : "Domínio Standard"
                                  : "Tier 1: Standard (50k msgs/dia)"}
                              </span>
                            </div>

                            <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl">
                              <span className="text-neutral-400 block text-[11px] mb-1">Limite Diário de Disparo:</span>
                              <span className="font-bold text-white">
                                {domainEconomics
                                  ? typeof domainEconomics.dailyLimit === "number"
                                    ? `${domainEconomics.dailyLimit.toLocaleString()} mensagens/dia`
                                    : domainEconomics.dailyLimit
                                  : "10.000 msgs/dia (Padrão)"}
                              </span>
                            </div>

                            <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl">
                              <span className="text-neutral-400 block text-[11px] mb-1">Infrações / Strikes Ativos:</span>
                              <span className="font-bold text-neutral-200">
                                {domainEconomics ? `${domainEconomics.strikeCount} strikes sofridos` : "0 strikes sofridos"}
                                <span className="text-[10px] text-emerald-400 font-normal ml-1.5">
                                  (Score: 100/100)
                                </span>
                              </span>
                            </div>

                            <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl">
                              <span className="text-neutral-400 block text-[11px] mb-1">Política Anti-Spam:</span>
                              <span className="font-bold text-neutral-200">
                                Validação Semântica P2P
                                <span className="text-[10px] text-neutral-400 font-normal ml-1.5">
                                  (3 strikes ativam Nuclear Option)
                                </span>
                              </span>
                            </div>
                          </div>

                          {/* Se for domínio autogovernado com carteira própria, exibe o buffer; caso contrário, exibe o card amigável de Cota Gerenciada */}
                          {(domainEconomics as any)?.isSelfGoverned ? (
                            <div className="p-4 bg-black/40 border border-white/[0.06] rounded-2xl flex items-center justify-between">
                              <div>
                                <span className="text-neutral-400 block text-[11px] mb-1">Saldo de Caução (Buffer da Empresa):</span>
                                <span className="font-bold text-amber-400 font-mono text-sm">
                                  {domainEconomics
                                    ? `${(Number(BigInt(domainEconomics.balanceWei || "0") / BigInt("1000000000000000")) / 1000).toFixed(3)} ETH`
                                    : "—"}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setIsTopUpOpen(true)}
                                className="px-3.5 py-1.5 bg-[#7d0000]/20 hover:bg-[#7d0000]/40 border border-[#7d0000]/40 text-red-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Recarregar Saldo</span>
                              </button>
                            </div>
                          ) : (
                            <div className="p-4 bg-emerald-950/20 border border-emerald-500/20 rounded-2xl flex items-start gap-3">
                              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                              <div>
                                <h4 className="text-xs font-bold text-emerald-200">
                                  Cota Operacional Gerenciada (Plano MAIVW Ativo)
                                </h4>
                                <p className="text-[11px] text-neutral-300 mt-1 leading-relaxed">
                                  Seu domínio opera com taxas e buffer operacional gerenciados pela plataforma. Não é necessário manter saldo de criptoativos em carteira própria para emissão e recebimento de mensagens.
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ========================================================== */}
            {/* TAB 5: CLUSTERS P2P & NÓS (GOVERNANÇA DA PLATAFORMA)      */}
            {/* ========================================================== */}
            {activeTab === "routing" && (
              <div className="space-y-6">
                {/* 1. Header & Platform Governance Banner */}
                <div className="bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl p-6 md:p-8 shadow-xl space-y-6 relative overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-white/[0.06] gap-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <Server className="w-5 h-5 text-indigo-400" />
                        <h3 className="text-base font-bold text-white">
                          Clusters Regionais &amp; Nós P2P
                        </h3>
                        <span className="px-2.5 py-0.5 text-[11px] font-bold tracking-wide rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          Governança da Plataforma MAIVW
                        </span>
                      </div>
                      <p className="text-xs text-neutral-400 mt-1">
                        Gerenciamento multi-cluster com Weighted Round-Robin, Circuit Breaker e failover instantâneo sem custo de gás on-chain.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsAddPoolModalOpen(true)}
                        className="px-3.5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-bold shadow-lg transition flex items-center gap-1.5 cursor-pointer active:scale-95"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Novo Cluster</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsAddRuleModalOpen(true)}
                        className="px-3.5 py-2 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer active:scale-95"
                      >
                        <Route className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Nova Regra de Domínio</span>
                      </button>

                      <button
                        type="button"
                        onClick={loadRoutingData}
                        disabled={isLoadingRouting}
                        className="p-2 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded-xl text-neutral-300 hover:text-white transition cursor-pointer"
                        title="Recarregar Métricas"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRouting ? "animate-spin" : ""}`} />
                      </button>
                    </div>
                  </div>

                  {/* Informative Rule Notice */}
                  <div className="p-4 bg-indigo-950/20 border border-indigo-500/30 rounded-2xl flex items-start gap-3">
                    <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                    <div className="text-xs space-y-1">
                      <p className="font-semibold text-white">
                        Diretriz Central de Roteamento MAIVW:
                      </p>
                      <p className="text-neutral-300 leading-relaxed">
                        Clientes sob a infraestrutura da MAIVW não selecionam nós ou clusters manualmente; a alocação, priorização de nós e failovers são gerenciados exclusivamente pela plataforma de acordo com a região, SLAs e saúde dos nós. Apenas servidores autohospedados externos possuem roteamento direto on-chain.
                      </p>
                    </div>
                  </div>

                  {routingActionMsg && (
                    <div
                      className={`p-3 rounded-xl text-xs flex items-center justify-between ${
                        routingActionMsg.ok
                          ? "bg-emerald-950/40 border border-emerald-500/40 text-emerald-300"
                          : "bg-red-950/40 border border-red-500/40 text-red-300"
                      }`}
                    >
                      <span>{routingActionMsg.message}</span>
                      <button
                        type="button"
                        onClick={() => setRoutingActionMsg(null)}
                        className="text-neutral-400 hover:text-white ml-2 cursor-pointer"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                {/* 2. Interactive Simulator */}
                <div className="bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl p-6 md:p-8 shadow-xl space-y-5">
                  <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-400" />
                        <span>Simulador de Resolução de Roteamento em Tempo Real</span>
                      </h4>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Teste como o Gateway MAIVW roteará qualquer domínio de entrada ou saída segundo as regras da plataforma.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={handleRunSimulation} className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <Globe className="w-4 h-4 text-neutral-500 absolute left-3 top-3" />
                      <input
                        type="text"
                        value={simulateDomainInput}
                        onChange={(e) => setSimulateDomainInput(e.target.value)}
                        placeholder="Digite um domínio de teste (ex: itau.com.br, bcb.gov.br, cliente.com)..."
                        required
                        className="w-full bg-black/60 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500 font-mono transition"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isSimulatingRoute}
                      className="px-5 py-2 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-lg active:scale-95"
                    >
                      {isSimulatingRoute ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                      <span>Simular Resolução</span>
                    </button>
                  </form>

                  {simulateResult && (
                    <div className="p-4 bg-black/50 border border-white/[0.08] rounded-2xl space-y-3 font-mono text-xs animate-in fade-in">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pb-3 border-b border-white/[0.06]">
                        <div>
                          <span className="text-[11px] text-neutral-400 block font-sans">Domínio Avaliado:</span>
                          <span className="font-bold text-white">{simulateResult.domain}</span>
                        </div>
                        <div>
                          <span className="text-[11px] text-neutral-400 block font-sans">Cluster Selecionado:</span>
                          <span className="font-bold text-indigo-400">
                            {simulateResult.poolName || simulateResult.poolCode || "DIRECT"} ({simulateResult.routeSource})
                          </span>
                        </div>
                        <div>
                          <span className="text-[11px] text-neutral-400 block font-sans">Governança:</span>
                          <span className={`font-bold ${simulateResult.isManagedByPlatform ? "text-emerald-400" : "text-amber-400"}`}>
                            {simulateResult.isManagedByPlatform ? "Gerenciado pela Plataforma" : "Autohospedado Direto"}
                          </span>
                        </div>
                      </div>

                      {simulateResult.selectedNode && (
                        <div className="p-3 bg-emerald-950/20 border border-emerald-500/30 rounded-xl flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                              <span className="font-bold text-white">{simulateResult.selectedNode.name}</span>
                              <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-sans">
                                Nó Primário (Peso: {simulateResult.selectedNode.weight})
                              </span>
                            </div>
                            <span className="text-[11px] text-neutral-400 block mt-1 font-mono">{simulateResult.selectedEndpoint}</span>
                          </div>
                          <span className="text-[11px] text-emerald-400 font-sans font-bold">Pronto para Disparo</span>
                        </div>
                      )}

                      {simulateResult.failoverCandidates && simulateResult.failoverCandidates.length > 1 && (
                        <div className="pt-2">
                          <span className="text-[11px] text-neutral-400 block mb-2 font-sans font-semibold">
                            Candidatos de Failover Imediato em Caso de Timeout (6s) / 5xx:
                          </span>
                          <div className="space-y-1.5">
                            {simulateResult.failoverCandidates.slice(1).map((cand: any, idx: number) => (
                              <div key={cand.id || idx} className="p-2 bg-white/[0.02] border border-white/[0.04] rounded-lg flex items-center justify-between text-[11px]">
                                <span className="text-neutral-300">
                                  {idx + 1}. {cand.name} ({cand.endpointUrl})
                                </span>
                                <span className="text-neutral-400 font-sans">
                                  Peso: {cand.weight} • {cand.isHealthy ? "🟢 Saudável" : "🔴 Quarentena"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 3. Clusters & Nodes List */}
                <div className="space-y-5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <Layers className="w-4 h-4 text-purple-400" />
                      <span>Clusters de Entrada &amp; Nós Receptores ({routingPools.length})</span>
                    </h4>
                  </div>

                  {routingPools.length === 0 ? (
                    <div className="p-8 text-center bg-[#0f0a0a]/80 border border-white/[0.08] rounded-3xl text-neutral-400 text-xs">
                      Nenhum cluster encontrado. Carregando ou configure o primeiro cluster.
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {routingPools.map((pool) => (
                        <div
                          key={pool.id}
                          className="bg-[#0f0a0a]/90 border border-white/[0.08] hover:border-white/[0.15] rounded-3xl p-6 md:p-7 shadow-xl space-y-5 transition"
                        >
                          {/* Pool Header */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-white/[0.06] gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2.5">
                                <h5 className="text-base font-bold text-white">{pool.name}</h5>
                                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white/[0.06] border border-white/[0.08] text-neutral-300">
                                  {pool.code}
                                </span>
                                <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                  {pool.region || "GLOBAL"}
                                </span>
                                {pool.isDefault && (
                                  <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                    Padrão
                                  </span>
                                )}
                              </div>
                              {pool.description && (
                                <p className="text-xs text-neutral-400">{pool.description}</p>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPoolIdForNode(pool.id);
                                  setIsAddNodeModalOpen(true);
                                }}
                                className="px-3 py-1.5 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                <span>Adicionar Nó</span>
                              </button>

                              {!pool.isDefault && (
                                <button
                                  type="button"
                                  onClick={() => handleDeletePool(pool.id)}
                                  className="p-1.5 bg-white/[0.03] hover:bg-red-500/20 border border-white/[0.06] text-neutral-400 hover:text-red-400 rounded-xl transition cursor-pointer"
                                  title="Excluir Cluster"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Nodes Table */}
                          {pool.nodes.length === 0 ? (
                            <div className="p-4 text-center bg-black/40 border border-white/[0.04] rounded-2xl text-neutral-500 text-xs">
                              Nenhum nó configurado neste cluster. Clique em &quot;Adicionar Nó&quot; para registrar uma instância receptora.
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-xs">
                                <thead>
                                  <tr className="text-neutral-400 border-b border-white/[0.04] text-[11px]">
                                    <th className="pb-2 font-medium">Nome &amp; Endpoint</th>
                                    <th className="pb-2 font-medium">Peso (Round-Robin)</th>
                                    <th className="pb-2 font-medium">Saúde (Circuit Breaker)</th>
                                    <th className="pb-2 font-medium">Latência</th>
                                    <th className="pb-2 font-medium text-right">Ações</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.04]">
                                  {pool.nodes.map((node) => (
                                    <tr key={node.id} className="hover:bg-white/[0.02]">
                                      <td className="py-3 pr-3">
                                        <div className="font-semibold text-white">{node.name}</div>
                                        <div className="text-[11px] font-mono text-neutral-400">{node.endpointUrl}</div>
                                      </td>
                                      <td className="py-3 pr-3">
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="number"
                                            defaultValue={node.weight}
                                            min={1}
                                            max={1000}
                                            onBlur={(e) => {
                                              const w = parseInt(e.target.value, 10);
                                              if (w && w !== node.weight) {
                                                handleUpdateNodeWeight(node.id, w);
                                              }
                                            }}
                                            className="w-16 bg-black/60 border border-white/10 rounded-lg px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                                          />
                                          <span className="text-[11px] text-neutral-500">pts</span>
                                        </div>
                                      </td>
                                      <td className="py-3 pr-3">
                                        {node.isHealthy ? (
                                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 inline-flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                            Saudável (0 falhas)
                                          </span>
                                        ) : (
                                          <div className="flex items-center gap-2">
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400 border border-red-500/30 inline-flex items-center gap-1">
                                              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                                              Quarentena ({node.failureCount} falhas)
                                            </span>
                                            <button
                                              type="button"
                                              onClick={() => handleResetNodeHealth(node.id)}
                                              className="text-[10px] px-2 py-0.5 bg-white/[0.06] hover:bg-white/[0.1] text-neutral-300 rounded font-semibold cursor-pointer transition"
                                            >
                                              Resetar
                                            </button>
                                          </div>
                                        )}
                                      </td>
                                      <td className="py-3 pr-3 font-mono text-neutral-300 text-[11px]">
                                        {node.responseTimeMs !== null && node.responseTimeMs !== undefined ? `${node.responseTimeMs} ms` : "—"}
                                      </td>
                                      <td className="py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                          <button
                                            type="button"
                                            onClick={() => handleToggleNodeActive(node)}
                                            className={`text-[10px] px-2.5 py-1 rounded-lg font-bold transition cursor-pointer ${
                                              node.isActive
                                                ? "bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-900/40"
                                                : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                                            }`}
                                          >
                                            {node.isActive ? "Ativo" : "Inativo"}
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => handleDeleteNode(node.id)}
                                            className="p-1 text-neutral-400 hover:text-red-400 transition cursor-pointer"
                                            title="Remover Nó"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 4. Domain Routing Rules */}
                <div className="bg-[#0f0a0a]/90 border border-white/[0.08] rounded-3xl p-6 md:p-8 shadow-xl space-y-5">
                  <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Route className="w-4 h-4 text-indigo-400" />
                        <span>Regras de Roteamento de Domínios ({routingRules.length})</span>
                      </h4>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        Mapeamento de padrões (ex: *.com.br, *.gov.br) para seus respectivos clusters de destino.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsAddRuleModalOpen(true)}
                      className="px-3.5 py-2 bg-indigo-600/30 hover:bg-indigo-600/50 border border-indigo-500/40 text-indigo-200 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer active:scale-95"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Nova Regra</span>
                    </button>
                  </div>

                  {routingRules.length === 0 ? (
                    <div className="p-4 text-center bg-black/40 border border-white/[0.04] rounded-2xl text-neutral-500 text-xs">
                      Nenhuma regra configurada. Todo o tráfego não direcionado será roteado para o Cluster Padrão (Global).
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead>
                          <tr className="text-neutral-400 border-b border-white/[0.04] text-[11px]">
                            <th className="pb-2 font-medium">Padrão de Domínio</th>
                            <th className="pb-2 font-medium">Cluster Alvo</th>
                            <th className="pb-2 font-medium">Prioridade</th>
                            <th className="pb-2 font-medium">Observações</th>
                            <th className="pb-2 font-medium text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                          {routingRules.map((rule) => (
                            <tr key={rule.id} className="hover:bg-white/[0.02]">
                              <td className="py-3 pr-3 font-mono font-bold text-white">{rule.domainPattern}</td>
                              <td className="py-3 pr-3 text-indigo-300 font-semibold">
                                {rule.pool?.name || `Pool #${rule.poolId}`}
                              </td>
                              <td className="py-3 pr-3">
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-white/[0.06] text-neutral-300">
                                  P{rule.priority}
                                </span>
                              </td>
                              <td className="py-3 pr-3 text-neutral-400 text-[11px]">{rule.notes || "—"}</td>
                              <td className="py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => handleDeleteRule(rule.id)}
                                  className="p-1 text-neutral-400 hover:text-red-400 transition cursor-pointer"
                                  title="Excluir Regra"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal: Nova Conta de E-mail */}
      {isAccountModalOpen && currentDomain && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0f0a0a] border border-white/[0.1] rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Mail className="w-4 h-4 text-red-400" />
                <span>Criar Conta de E-mail</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsAccountModalOpen(false)}
                className="text-neutral-400 hover:text-white text-xs cursor-pointer"
              >
                ✕ Fechar
              </button>
            </div>

            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Endereço de E-mail</label>
                <div className="flex items-center bg-[#150d0d] border border-white/[0.09] rounded-xl overflow-hidden focus-within:border-[#7d0000]">
                  <input
                    type="text"
                    value={newLocalPart}
                    onChange={(e) => setNewLocalPart(e.target.value.toLowerCase().trim())}
                    placeholder="contato"
                    required
                    autoFocus
                    className="w-32 px-3 py-2.5 bg-transparent text-sm font-semibold text-white placeholder-neutral-500 focus:outline-none"
                  />
                  <span className="px-3 text-xs font-mono text-neutral-400 bg-white/[0.02] py-2.5 border-l border-white/[0.08] flex-1 truncate">
                    @{currentDomain.domainName}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Nome de Exibição</label>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="Ex: Suporte ao Cliente"
                  className="w-full px-3 py-2 bg-[#150d0d] border border-white/[0.09] rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#7d0000]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Senha de Acesso (Mínimo 6)</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••••••"
                    required
                    minLength={12}
                    maxLength={128}
                    className="w-full px-3 py-2 pr-10 bg-[#150d0d] border border-white/[0.09] rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#7d0000]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-2 text-neutral-500 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {accountError && (
                <div className="flex items-center gap-2 p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-300">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{accountError}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAccountModalOpen(false)}
                  className="px-4 py-2 border border-white/[0.08] hover:bg-white/[0.04] text-xs font-semibold rounded-xl text-neutral-400 hover:text-white transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCreatingAccount || !newLocalPart.trim() || newPassword.length < 12 || newPassword.length > 128}
                  className="px-5 py-2 bg-gradient-to-r from-[#7d0000] to-[#990000] hover:from-[#900000] hover:to-[#b30000] text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-md disabled:opacity-50"
                >
                  {isCreatingAccount ? "Criando..." : "Criar Caixa"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Nova Chave de API */}
      {isKeyModalOpen && currentDomain && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0f0a0a] border border-white/[0.1] rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-red-400" />
                <span>Gerar Chave de API</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsKeyModalOpen(false)}
                className="text-neutral-400 hover:text-white text-xs cursor-pointer"
              >
                ✕ Fechar
              </button>
            </div>

            <form onSubmit={handleCreateApiKey} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Nome Identificador</label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Ex: Backend Produção"
                  required
                  autoFocus
                  className="w-full px-3 py-2 bg-[#150d0d] border border-white/[0.09] rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#7d0000]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Ambiente</label>
                <select
                  value={newKeyEnv}
                  onChange={(e) => setNewKeyEnv(e.target.value as any)}
                  className="w-full px-3 py-2 bg-[#150d0d] border border-white/[0.09] rounded-xl text-xs text-white focus:outline-none focus:border-[#7d0000] cursor-pointer"
                >
                  <option value="production">Production</option>
                  <option value="staging">Staging / Testes</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsKeyModalOpen(false)}
                  className="px-4 py-2 border border-white/[0.08] hover:bg-white/[0.04] text-xs font-semibold rounded-xl text-neutral-400 hover:text-white transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isCreatingKey || !newKeyName.trim()}
                  className="px-5 py-2 bg-gradient-to-r from-[#7d0000] to-[#990000] hover:from-[#900000] hover:to-[#b30000] text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-md disabled:opacity-50"
                >
                  {isCreatingKey ? "Gerando..." : "Gerar Chave"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Recarga de Caução (Top-Up) */}
      {isTopUpOpen && currentDomain && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0f0a0a] border border-white/[0.1] rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-400" />
                <span>Recarregar Saldo de Caução</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsTopUpOpen(false)}
                className="text-neutral-400 hover:text-white text-xs cursor-pointer"
              >
                ✕ Fechar
              </button>
            </div>

            <form onSubmit={handleExecuteTopUp} className="space-y-4">
              <p className="text-xs text-neutral-400 leading-relaxed">
                Adicione fundos à caução do domínio <strong className="text-white">{currentDomain.domainName}</strong>. 
                Se o domínio estiver suspenso por strikes, ele será reativado automaticamente pelo Smart Contract na blockchain.
              </p>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Valor da Recarga (ETH)</label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {["1", "5", "10"].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setTopUpAmount(amt)}
                      className={`py-2 rounded-xl text-xs font-bold border transition ${
                        topUpAmount === amt
                          ? "bg-[#7d0000]/40 border-[#7d0000] text-white"
                          : "bg-black/30 border-white/[0.08] text-neutral-400 hover:text-white"
                      }`}
                    >
                      {amt} ETH
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  placeholder="Ex: 1"
                  required
                  className="w-full px-3 py-2 bg-[#150d0d] border border-white/[0.09] rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#7d0000]"
                />
              </div>

              {topUpSuccessMsg && (
                <div className="flex items-center gap-2 p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300">
                  <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{topUpSuccessMsg}</span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsTopUpOpen(false)}
                  className="px-4 py-2 border border-white/[0.08] hover:bg-white/[0.04] text-xs font-semibold rounded-xl text-neutral-400 hover:text-white transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingTopUp || !topUpAmount.trim()}
                  className="px-5 py-2 bg-gradient-to-r from-[#7d0000] to-[#990000] hover:from-[#900000] hover:to-[#b30000] text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-md disabled:opacity-50 flex items-center gap-2"
                >
                  {isSubmittingTopUp && <RefreshCw className="w-3 h-3 animate-spin" />}
                  <span>{isSubmittingTopUp ? "Processando..." : "Confirmar Recarga"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Checkout de Pagamento para Espelhamento Multi-Chain */}
      {isMirrorPaymentModalOpen && pendingMirrorTargetNet && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-[#0d0909] border border-blue-500/30 rounded-3xl p-6 shadow-2xl space-y-5 text-white max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <span>Espelhar em {pendingMirrorTargetNet.name}</span>
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                      Chain ID: {pendingMirrorTargetNet.id}
                    </span>
                  </h3>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Domínio: <span className="font-mono text-white font-semibold">{currentDomain?.domainName}</span>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsMirrorPaymentModalOpen(false);
                  setIsPollingMirrorPix(false);
                }}
                className="text-neutral-400 hover:text-white p-1 rounded-lg hover:bg-white/[0.05] transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Price Badge */}
            <div className="flex items-center justify-between p-3.5 bg-blue-950/20 border border-blue-500/20 rounded-2xl">
              <div>
                <span className="text-xs text-neutral-400">Taxa de Atestação do Oráculo:</span>
                <div className="text-base font-extrabold text-blue-300">
                  $10.00 USD <span className="text-xs font-normal text-neutral-400">/ R$ 55,00 BRL</span>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2.5 py-1 rounded-xl">
                Taxa Única
              </span>
            </div>

            {/* Tabs de Pagamento */}
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-black/60 border border-white/[0.08] rounded-2xl">
              {[
                { id: "pix", label: "PIX", icon: QrCode, activeClass: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" },
                { id: "card", label: "Cartão", icon: CreditCard, activeClass: "bg-blue-500/20 text-blue-300 border-blue-500/40" },
                { id: "voucher", label: "Voucher", icon: Ticket, activeClass: "bg-purple-500/20 text-purple-300 border-purple-500/40" },
                { id: "web3", label: "Web3", icon: Wallet, activeClass: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = mirrorPaymentMethod === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setMirrorPaymentMethod(tab.id as any);
                      setMirrorPaymentError(null);
                    }}
                    className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl text-xs font-bold transition border cursor-pointer ${
                      isActive
                        ? tab.activeClass
                        : "border-transparent text-neutral-400 hover:text-white hover:bg-white/[0.04]"
                    }`}
                  >
                    <Icon className="w-4 h-4 mb-1" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Error Message */}
            {mirrorPaymentError && (
              <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                <span>{mirrorPaymentError}</span>
              </div>
            )}

            {/* Tab Body: PIX */}
            {mirrorPaymentMethod === "pix" && (
              <div className="space-y-4">
                {!mirrorPaymentData?.pixQrCode ? (
                  <div className="text-center py-4 space-y-3">
                    <p className="text-xs text-neutral-300">
                      Gere o QR Code PIX com confirmação automática via Asaas / Sandbox.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleCreateMirrorPayment("pix")}
                      disabled={isCreatingMirrorPayment}
                      className="w-full py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                    >
                      {isCreatingMirrorPayment ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Gerando Cobrança PIX...</span>
                        </>
                      ) : (
                        <>
                          <QrCode className="w-4 h-4" />
                          <span>Gerar Cobrança PIX (R$ 55,00)</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex justify-center p-3 bg-white rounded-2xl max-w-[200px] mx-auto shadow-inner">
                      <img
                        src={`data:image/png;base64,${mirrorPaymentData.pixQrCode}`}
                        alt="QR Code PIX Espelhamento"
                        className="w-40 h-40 object-contain"
                      />
                    </div>
                    {mirrorPaymentData.pixCopyPaste && (
                      <div className="flex items-center gap-2 bg-black/60 p-2.5 rounded-xl border border-white/[0.08]">
                        <input
                          type="text"
                          readOnly
                          value={mirrorPaymentData.pixCopyPaste}
                          className="bg-transparent text-[11px] font-mono text-neutral-300 w-full outline-none truncate"
                        />
                        <button
                          type="button"
                          onClick={() => copyToClipboard(mirrorPaymentData.pixCopyPaste!, "pix-mirror")}
                          className="p-1.5 bg-white/[0.08] hover:bg-white/[0.15] rounded-lg transition shrink-0 cursor-pointer"
                          title="Copiar Chave PIX"
                        >
                          {copiedKey === "pix-mirror" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-neutral-300" />}
                        </button>
                      </div>
                    )}

                    <div className="flex items-center justify-center gap-2 text-xs text-neutral-400">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                      <span>Aguardando liquidação do PIX...</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleConfirmMirrorTestnet}
                      disabled={isConfirmingMirrorTestnet}
                      className="w-full py-2.5 bg-gradient-to-r from-emerald-600/30 to-teal-600/30 border border-emerald-500/40 hover:bg-emerald-600/40 text-emerald-300 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition cursor-pointer"
                    >
                      {isConfirmingMirrorTestnet ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Confirmando Ancoragem On-Chain...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5 text-emerald-400" />
                          <span>⚡ Simular Confirmação em Sandbox (Testnet)</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Tab Body: Cartão Stripe */}
            {mirrorPaymentMethod === "card" && (
              <div className="space-y-4">
                {!mirrorPaymentData?.checkoutUrl ? (
                  <div className="text-center py-4 space-y-3">
                    <p className="text-xs text-neutral-300">
                      Pague com cartão de crédito internacional de forma segura via Stripe.
                    </p>
                    <button
                      type="button"
                      onClick={() => handleCreateMirrorPayment("card")}
                      disabled={isCreatingMirrorPayment}
                      className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-blue-950/50 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                    >
                      {isCreatingMirrorPayment ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Preparando Checkout Stripe...</span>
                        </>
                      ) : (
                        <>
                          <CreditCard className="w-4 h-4" />
                          <span>Iniciar Checkout com Cartão ($10.00 USD)</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <a
                      href={mirrorPaymentData.checkoutUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition"
                    >
                      <span>Abrir Checkout Stripe</span>
                      <ExternalLink className="w-4 h-4" />
                    </a>

                    <button
                      type="button"
                      onClick={handleConfirmMirrorTestnet}
                      disabled={isConfirmingMirrorTestnet}
                      className="w-full py-2.5 bg-gradient-to-r from-blue-600/30 to-indigo-600/30 border border-blue-500/40 hover:bg-blue-600/40 text-blue-300 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition cursor-pointer"
                    >
                      {isConfirmingMirrorTestnet ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Confirmando Ancoragem On-Chain...</span>
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5 text-blue-400" />
                          <span>⚡ Simular Confirmação Stripe (Sandbox)</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Tab Body: Voucher B2B */}
            {mirrorPaymentMethod === "voucher" && (
              <div className="space-y-3 py-2">
                <p className="text-xs text-neutral-300">
                  Insira a chave de licença ou voucher corporativo emitido para sua organização.
                </p>
                <input
                  type="text"
                  value={mirrorVoucherKey}
                  onChange={(e) => setMirrorVoucherKey(e.target.value.toUpperCase())}
                  placeholder="Ex: MAIVW-ENTERPRISE-2026"
                  className="w-full bg-black/60 border border-purple-500/30 rounded-xl px-3.5 py-2.5 text-xs font-mono text-white placeholder-neutral-500 focus:outline-none focus:border-purple-400"
                />
                <button
                  type="button"
                  onClick={() => handleCreateMirrorPayment("voucher")}
                  disabled={isCreatingMirrorPayment || !mirrorVoucherKey.trim()}
                  className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-purple-950/50 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  {isCreatingMirrorPayment ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Validando Chave...</span>
                    </>
                  ) : (
                    <>
                      <Ticket className="w-4 h-4" />
                      <span>Resgatar Licença &amp; Ativar Espelho</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Tab Body: Web3 MetaMask */}
            {mirrorPaymentMethod === "web3" && (
              <div className="space-y-4 py-2 text-left">
                <div className="p-3.5 bg-white/[0.02] border border-white/[0.06] rounded-xl text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Carteira Web3:</span>
                    <span className="font-mono text-amber-400 font-semibold">
                      {mirrorWeb3WalletAddress
                        ? `${mirrorWeb3WalletAddress.slice(0, 6)}...${mirrorWeb3WalletAddress.slice(-4)}`
                        : "Não conectada"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400">Rede Destino:</span>
                    <span className="font-semibold text-white">
                      {pendingMirrorTargetNet.name} (ID: {pendingMirrorTargetNet.id})
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-white/[0.04] pt-1.5">
                    <span className="text-neutral-400">Taxa de Espelhamento:</span>
                    <span className="font-bold text-amber-400">
                      {pendingMirrorTargetNet.mirrorFeeFormatted}
                    </span>
                  </div>
                </div>

                {mirrorWeb3StatusStep && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-2.5 text-xs text-amber-300 animate-pulse">
                    <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                    <span>{mirrorWeb3StatusStep}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handlePayWeb3MirrorDirect}
                  disabled={isConnectingWeb3Mirror}
                  className="w-full py-3 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-amber-950/50 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                >
                  {isConnectingWeb3Mirror ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Processando na Carteira...</span>
                    </>
                  ) : (
                    <>
                      <Wallet className="w-4 h-4" />
                      <span>
                        Assinar Espelho na {pendingMirrorTargetNet.name} ({pendingMirrorTargetNet.mirrorFeeFormatted})
                      </span>
                    </>
                  )}
                </button>

                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={async () => {
                      setIsMirrorPaymentModalOpen(false);
                      await handleActivateMirror(pendingMirrorTargetNet.id);
                    }}
                    disabled={isConnectingWeb3Mirror}
                    className="text-[11px] text-neutral-400 hover:text-amber-400 underline decoration-neutral-600 underline-offset-4 transition cursor-pointer"
                  >
                    Sem saldo de gas na rede {pendingMirrorTargetNet.name}? Ativar via Relayer / Simulação Testnet
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Confirmação de Espelhamento Multi-Chain */}
      {mirrorModalData && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0f0a0a] border border-blue-500/30 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center mx-auto text-blue-400">
              <CheckCircle2 className="w-6 h-6" />
            </div>

            <div className="text-center">
              <h3 className="text-lg font-bold text-white">Espelhamento Ativado com Sucesso!</h3>
              <p className="text-xs text-neutral-400 mt-1">
                O domínio <strong className="text-white">{currentDomain?.domainName}</strong> agora está oficialmente espelhado na rede <strong>{mirrorModalData.targetNetworkName}</strong>.
              </p>
            </div>

            <div className="p-3.5 bg-black/50 border border-white/[0.08] rounded-xl space-y-2 text-xs">
              <div className="flex justify-between text-neutral-400">
                <span>Rede de Destino:</span>
                <span className="font-bold text-white">{mirrorModalData.targetNetworkName}</span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>Taxa Paga ao Oráculo:</span>
                <span className="font-bold text-amber-400">{mirrorModalData.mirrorFee}</span>
              </div>
              <div className="flex justify-between text-neutral-400">
                <span>Hash da Transação:</span>
                <span className="font-mono text-neutral-300 truncate max-w-[180px]" title={mirrorModalData.txHash}>
                  {mirrorModalData.txHash}
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              {mirrorModalData.explorerUrl && (
                <a
                  href={mirrorModalData.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 py-2.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                >
                  <span>Ver no Explorer</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setMirrorModalData(null)}
                className="flex-1 py-2.5 bg-white/[0.08] hover:bg-white/[0.12] text-white rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Criar Novo Cluster / Pool */}
      {isAddPoolModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0f0a0a] border border-white/[0.1] rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Server className="w-4 h-4 text-indigo-400" />
                <span>Novo Cluster / Pool Regional</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsAddPoolModalOpen(false)}
                className="text-neutral-400 hover:text-white text-xs cursor-pointer"
              >
                ✕ Fechar
              </button>
            </div>

            <form onSubmit={handleCreatePool} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Código Identificador (Slug)</label>
                <input
                  type="text"
                  value={newPoolCode}
                  onChange={(e) => setNewPoolCode(e.target.value.toLowerCase().trim())}
                  placeholder="ex: sa-east-1, us-east-1, vip-banks"
                  required
                  className="w-full bg-[#150d0d] border border-white/[0.09] rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Nome do Cluster</label>
                <input
                  type="text"
                  value={newPoolName}
                  onChange={(e) => setNewPoolName(e.target.value)}
                  placeholder="ex: Cluster América do Sul (São Paulo)"
                  required
                  className="w-full bg-[#150d0d] border border-white/[0.09] rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-1">Região Geográfica</label>
                  <select
                    value={newPoolRegion}
                    onChange={(e) => setNewPoolRegion(e.target.value)}
                    className="w-full bg-[#150d0d] border border-white/[0.09] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="GLOBAL">GLOBAL</option>
                    <option value="BR">América do Sul (BR)</option>
                    <option value="US">América do Norte (US)</option>
                    <option value="EU">Europa (EU)</option>
                  </select>
                </div>

                <div className="flex items-center pt-6">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-neutral-300">
                    <input
                      type="checkbox"
                      checked={newPoolIsDefault}
                      onChange={(e) => setNewPoolIsDefault(e.target.checked)}
                      className="rounded border-white/20 bg-black/60 text-indigo-600 focus:ring-0"
                    />
                    <span>Cluster Padrão</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Descrição</label>
                <textarea
                  value={newPoolDesc}
                  onChange={(e) => setNewPoolDesc(e.target.value)}
                  placeholder="Finalidade do cluster, nós previstos e diretrizes de baixa latência..."
                  rows={2}
                  className="w-full bg-[#150d0d] border border-white/[0.09] rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddPoolModalOpen(false)}
                  className="px-4 py-2 bg-white/[0.05] hover:bg-white/[0.1] text-neutral-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPool}
                  className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer"
                >
                  {isSubmittingPool && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Criar Cluster</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Adicionar Nó ao Cluster */}
      {isAddNodeModalOpen && selectedPoolIdForNode && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0f0a0a] border border-white/[0.1] rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Server className="w-4 h-4 text-indigo-400" />
                <span>Adicionar Nó ao Cluster</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsAddNodeModalOpen(false)}
                className="text-neutral-400 hover:text-white text-xs cursor-pointer"
              >
                ✕ Fechar
              </button>
            </div>

            <form onSubmit={handleCreateNode} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Nome do Nó</label>
                <input
                  type="text"
                  value={newNodeName}
                  onChange={(e) => setNewNodeName(e.target.value)}
                  placeholder="ex: Gateway GRU Edge-01"
                  required
                  className="w-full bg-[#150d0d] border border-white/[0.09] rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">URL Receptor do Endpoint</label>
                <input
                  type="url"
                  value={newNodeUrl}
                  onChange={(e) => setNewNodeUrl(e.target.value)}
                  placeholder="https://node-gru-1.maivw.internal/api/v1/inbox"
                  required
                  className="w-full bg-[#150d0d] border border-white/[0.09] rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  Peso no Weighted Round-Robin (1 a 1000)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={newNodeWeight}
                    onChange={(e) => setNewNodeWeight(parseInt(e.target.value, 10) || 100)}
                    required
                    className="w-24 bg-[#150d0d] border border-white/[0.09] rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                  />
                  <span className="text-xs text-neutral-400">
                    Maior peso recebe proporcionalmente mais tráfego (ex: 70 vs 30).
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddNodeModalOpen(false)}
                  className="px-4 py-2 bg-white/[0.05] hover:bg-white/[0.1] text-neutral-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingNode}
                  className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer"
                >
                  {isSubmittingNode && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Adicionar Nó</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Nova Regra de Domínio */}
      {isAddRuleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0f0a0a] border border-white/[0.1] rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Route className="w-4 h-4 text-indigo-400" />
                <span>Nova Regra de Mapeamento de Domínio</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsAddRuleModalOpen(false)}
                className="text-neutral-400 hover:text-white text-xs cursor-pointer"
              >
                ✕ Fechar
              </button>
            </div>

            <form onSubmit={handleCreateRule} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">
                  Padrão do Domínio
                </label>
                <input
                  type="text"
                  value={newRulePattern}
                  onChange={(e) => setNewRulePattern(e.target.value.toLowerCase().trim())}
                  placeholder="ex: *.com.br, itau.com.br, *.gov.br"
                  required
                  className="w-full bg-[#150d0d] border border-white/[0.09] rounded-xl px-3 py-2 text-xs text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Cluster de Destino</label>
                <select
                  value={newRulePoolId || ""}
                  onChange={(e) => setNewRulePoolId(parseInt(e.target.value, 10))}
                  required
                  className="w-full bg-[#150d0d] border border-white/[0.09] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Selecione um Cluster...</option>
                  {routingPools.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Prioridade (0 a 100)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={newRulePriority}
                  onChange={(e) => setNewRulePriority(parseInt(e.target.value, 10) || 10)}
                  className="w-24 bg-[#150d0d] border border-white/[0.09] rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-300 mb-1">Observações</label>
                <input
                  type="text"
                  value={newRuleNotes}
                  onChange={(e) => setNewRuleNotes(e.target.value)}
                  placeholder="ex: Roteamento de baixa latência para clientes bancários"
                  className="w-full bg-[#150d0d] border border-white/[0.09] rounded-xl px-3 py-2 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddRuleModalOpen(false)}
                  className="px-4 py-2 bg-white/[0.05] hover:bg-white/[0.1] text-neutral-300 rounded-xl text-xs font-semibold transition cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRule}
                  className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer"
                >
                  {isSubmittingRule && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Salvar Regra</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-5 text-center text-xs text-neutral-500">
        <p>
          Protocolo MAIVW — Console Administrativo Corporativo. Cartório Descentralizado Multi-Chain.
        </p>
      </footer>
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#070101] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-red-600/30 border-t-red-600 rounded-full animate-spin" />
        </div>
      }
    >
      <AdminConsole />
    </Suspense>
  );
}
