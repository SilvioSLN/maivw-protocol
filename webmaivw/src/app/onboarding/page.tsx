"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShieldCheck,
  CheckCircle2,
  Copy,
  Check,
  ArrowRight,
  Globe,
  Lock,
  Zap,
  RefreshCw,
  Mail,
  AlertCircle,
  ExternalLink,
  Sparkles,
  ChevronRight,
  LogOut,
  UserCheck,
  Cloud,
  X,
  ChevronDown,
  ChevronUp,
  Network,
  QrCode,
  CreditCard,
  Ticket,
  Wallet,
  Inbox,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  connectWeb3Wallet,
  ensureWalletChain,
  encodeRegisterCompanyCall,
  sendWeb3Transaction,
  SUPPORTED_CHAINS,
} from "@/lib/web3";

type Stage = "domain" | "dns" | "onchain" | "complete";
type Purpose = "both" | "webmail" | "api";

type OriginNetworkKey = "base" | "solana" | "arbitrum" | "polygon";

interface OriginNetworkOption {
  key: OriginNetworkKey;
  name: string;
  badge: string;
  desc: string;
  chainId?: number;
  family: "EVM" | "SOLANA";
}

const ORIGIN_NETWORK_OPTIONS: OriginNetworkOption[] = [
  {
    key: "base",
    name: "Base",
    badge: "Padrão",
    desc: "L2 Coinbase • Baixo custo & alta liquidez",
    chainId: 84532,
    family: "EVM",
  },
  {
    key: "solana",
    name: "Solana",
    badge: "Ed25519",
    desc: "Cluster Solana • Assinatura SPL & alta velocidade",
    family: "SOLANA",
  },
  {
    key: "arbitrum",
    name: "Arbitrum",
    badge: "Nitro L2",
    desc: "Nitro Rollup • Segurança Ethereum & baixo custo",
    chainId: 421614,
    family: "EVM",
  },
  {
    key: "polygon",
    name: "Polygon",
    badge: "AggLayer",
    desc: "AggLayer PoS • Taxas ultrabaixas em POL",
    chainId: 80002,
    family: "EVM",
  },
];

function resolveDefaultOriginNetwork(): OriginNetworkKey {
  const envVal = (process.env.NEXT_PUBLIC_DEFAULT_ORIGIN_NETWORK || "base").toLowerCase().trim();
  if (envVal === "solana") return "solana";
  if (envVal === "arbitrum" || envVal === "421614") return "arbitrum";
  if (envVal === "polygon" || envVal === "80002") return "polygon";
  return "base";
}

interface DnsRecordInfo {
  type: string;
  host: string;
  name: string;
  value: string;
  purpose: string;
  required: boolean;
  priority?: number;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { user, isLoading, logout, refreshUser, gatewayUrl } = useAuth();

  const [stage, setStage] = useState<Stage>("domain");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showCloudflareAssistant, setShowCloudflareAssistant] = useState(false);
  const [showCloudflareEmailAssistant, setShowCloudflareEmailAssistant] = useState(false);
  const [showEmailDnsCard, setShowEmailDnsCard] = useState(false);
  const [showAdvancedPayment, setShowAdvancedPayment] = useState(false);

  // Origin Network Selection (Transparente por padrão, configurável via env e seletor discreto)
  const [selectedOriginNetwork, setSelectedOriginNetwork] = useState<OriginNetworkKey>(resolveDefaultOriginNetwork);
  const [showNetworkPicker, setShowNetworkPicker] = useState<boolean>(false);

  // Domain Stage
  const [domainName, setDomainName] = useState("");
  const [isGeneratingChallenge, setIsGeneratingChallenge] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [solanaRegistrant, setSolanaRegistrant] = useState<string | null>(null);
  const [customSolanaPubkey, setCustomSolanaPubkey] = useState<string>("");
  const [showSolanaAdvanced, setShowSolanaAdvanced] = useState<boolean>(false);
  const [showSolanaPubkeyReceipt, setShowSolanaPubkeyReceipt] = useState<boolean>(false);
  const [records, setRecords] = useState<Record<string, DnsRecordInfo> | null>(null);

  // DNS Stage
  const [isCheckingDns, setIsCheckingDns] = useState(false);
  const [dnsVerified, setDnsVerified] = useState(false);
  const [dnsCheckResult, setDnsCheckResult] = useState<any>(null);
  const [dnsError, setDnsError] = useState<string | null>(null);

  // On-Chain Registration Stage
  const [isRegisteringOnChain, setIsRegisteringOnChain] = useState(false);
  const [onChainError, setOnChainError] = useState<string | null>(null);
  const [pendingRegistration, setPendingRegistration] = useState<{ domainId: number; txHash: string; endpointUrl: string; targetChainId: number } | null>(null);
  const [targetChainId, setTargetChainId] = useState<number>(() => {
    const def = resolveDefaultOriginNetwork();
    if (def === "arbitrum") return 421614;
    if (def === "polygon") return 80002;
    return 84532;
  });
  const [showAdvancedNetwork, setShowAdvancedNetwork] = useState<boolean>(false);
  const [onChainData, setOnChainData] = useState<{
    txHash: string;
    basescanUrl: string;
    publicKey: string;
    network: string;
    endpointUrl: string;
    oracleAttestationVerified: boolean;
    domainId: number;
  } | null>(null);

  // Payment & Settlement States
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "card" | "voucher" | "web3">("web3");
  const [isCreatingPayment, setIsCreatingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [pixOrder, setPixOrder] = useState<{
    orderId: string;
    pixQrCode: string;
    pixCopyPaste: string;
    amountBrl: number;
    amountUsd: number;
    isTestnet: boolean;
  } | null>(null);
  const [isPollingPix, setIsPollingPix] = useState(false);
  const [isSimulatingPayment, setIsSimulatingPayment] = useState(false);
  const [voucherCode, setVoucherCode] = useState("");
  const [voucherSuccess, setVoucherSuccess] = useState<string | null>(null);
  const [cardOrder, setCardOrder] = useState<{
    orderId: string;
    checkoutUrl: string;
    amountUsd: number;
    isTestnet: boolean;
  } | null>(null);
  const [web3WalletAddress, setWeb3WalletAddress] = useState<string | null>(null);
  const [isConnectingWeb3, setIsConnectingWeb3] = useState(false);
  const [isRegisteringWeb3Direct, setIsRegisteringWeb3Direct] = useState(false);
  const [web3StatusStep, setWeb3StatusStep] = useState<string | null>(null);

  // Self-Hosted Mode & P2P Inbound Endpoint States
  const [nodeMode, setNodeMode] = useState<{
    chainId: number;
    isCloud: boolean;
    isSelfHosted: boolean;
    isOracleAuthority: boolean;
    oracleAddress?: string;
    contractOracleAddress?: string;
    remoteOracleUrl?: string;
    defaultEndpoint?: string;
    defaultEndpointPattern?: string;
    dnsMode?: "local-demo" | "public-dns";
    solanaEnabled?: boolean;
    solanaNetworkId?: string | null;
    solanaNetworkName?: string | null;
  } | null>(null);
  const [p2pEndpoint, setP2pEndpoint] = useState<string>("");
  const [p2pEndpointError, setP2pEndpointError] = useState<string | null>(null);
  const [stepperStep, setStepperStep] = useState<number>(0);
  const [showP2pDnsCard, setShowP2pDnsCard] = useState<boolean>(true);

  // Consulta configuração de operação do nó
  useEffect(() => {
    async function checkNodeMode() {
      try {
        const res = await fetch(`${gatewayUrl}/api/v1/onboarding/node-mode`);
        if (res.ok) {
          const data = await res.json();
          setNodeMode(data);
          if (Number.isInteger(data.chainId) && selectedOriginNetwork === "base") {
            setTargetChainId(data.chainId);
          }
          if (data.defaultEndpoint) setP2pEndpoint(data.defaultEndpoint);
        }
      } catch {
        // Fallback para autodetecção local
      }
    }
    checkNodeMode();
  }, [gatewayUrl, selectedOriginNetwork]);

  // Mantém sugestão do endpoint P2P atualizada com o domínio
  useEffect(() => {
    const clean = domainName.trim().toLowerCase();
    if (clean && !p2pEndpoint) {
      setP2pEndpoint(`https://mw-p2p.${clean}/api/v1/inbox`);
    }
  }, [domainName, p2pEndpoint]);

  const isCloudInstallation = Boolean(
    nodeMode?.isCloud ||
    process.env.NEXT_PUBLIC_IS_CLOUD === "true" ||
    (nodeMode === null &&
      typeof window !== "undefined" &&
      (window.location.hostname.includes("cloud.maivw.com") || window.location.hostname === "app.maivw.com"))
  );

  const isSovereignInstallation = !isCloudInstallation;

  const isSelfHosted = nodeMode
    ? nodeMode.isSelfHosted
    : typeof window !== "undefined"
      ? window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        !window.location.hostname.includes("maivw.com")
      : true;

  const endpointRequiresHttps = nodeMode?.dnsMode !== "local-demo";

  const validateP2pEndpoint = (endpoint: string): boolean => {
    if (!endpoint) return true;
    try {
      const parsed = new URL(endpoint);
      if (endpointRequiresHttps && parsed.protocol !== "https:") {
        setP2pEndpointError("O endpoint P2P deve usar HTTPS fora da demonstração local.");
        return false;
      }
      if (!endpointRequiresHttps && parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        setP2pEndpointError("O endpoint P2P deve usar HTTP ou HTTPS.");
        return false;
      }
      return true;
    } catch {
      setP2pEndpointError("Informe uma URL válida para o endpoint P2P.");
      return false;
    }
  };

  // Auth Guard: redirect to /signup if not logged in
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace("/signup");
    }
  }, [user, isLoading, router]);



  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleOpenCloudflareForTxt = () => {
    // 1. Abre a Cloudflare imediatamente para evitar bloqueio de pop-up do navegador
    try {
      window.open("https://dash.cloudflare.com/", "_blank");
    } catch { }
    // 2. Copia o valor do registro TXT automaticamente para conveniência
    if (records?.txt?.value) {
      navigator.clipboard.writeText(records.txt.value).catch(() => { });
      setCopiedKey("cf_txt_auto");
      setTimeout(() => setCopiedKey(null), 3000);
    }
    // 3. Abre o modal assistente guiado
    setShowCloudflareAssistant(true);
  };

  const handleOpenCloudflareForEmail = () => {
    // 1. Abre a Cloudflare imediatamente no clique
    try {
      window.open("https://dash.cloudflare.com/", "_blank");
    } catch { }
    // 2. Copia a entrada de recebimento MX (com fallback resiliente)
    const mxVal = records?.mx?.value || "inbound.maivw.com";
    navigator.clipboard.writeText(mxVal).catch(() => { });
    setCopiedKey("cf_email_auto");
    setTimeout(() => setCopiedKey(null), 3000);
    // 3. Abre o modal assistente de e-mails
    setShowCloudflareEmailAssistant(true);
  };

  // STAGE: DOMAIN CHALLENGE
  const handleGenerateChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = domainName.trim().toLowerCase();
    if (!clean || !clean.includes(".")) {
      setDomainError("Informe um domínio corporativo válido (ex: empresa.com.br)");
      return;
    }

    if (selectedOriginNetwork === "solana" && nodeMode && !nodeMode.solanaEnabled) {
      setDomainError("A rede Solana não está ativa neste nó. Ative SOLANA_ENABLED no .env ou selecione outra rede de ancoragem.");
      return;
    }

    setIsGeneratingChallenge(true);
    setDomainError(null);

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/onboarding/challenge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user?.token || localStorage.getItem("maivw_token") || ""}`,
        },
        body: JSON.stringify({
          domainName: clean,
          userId: user?.id || 1,
          targetNetwork: selectedOriginNetwork,
          registrant: customSolanaPubkey.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setDomainError(data.message || data.error || "Erro ao consultar domínio");
        return;
      }

      setChallengeToken(data.token);
      setChallengeId(data.challengeId || null);
      if (data.origin?.registrant) {
        setSolanaRegistrant(data.origin.registrant);
      }
      setRecords(data.records);
      setStage("dns");
    } catch {
      setDomainError("Falha de conexão com o Gateway MAIVW.");
    } finally {
      setIsGeneratingChallenge(false);
    }
  };

  // STAGE: VERIFY DNS POSSESSION
  const handleCheckDns = async () => {
    if (!challengeToken) return;

    setIsCheckingDns(true);
    setDnsError(null);

    try {
      const res = await fetch(`${gatewayUrl}/api/v1/onboarding/check-dns`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user?.token || localStorage.getItem("maivw_token") || ""}` },
        body: JSON.stringify({
          domainName: domainName.trim().toLowerCase(),
          token: challengeToken,
          challengeId: challengeId || undefined,
        }),
      });

      const data = await res.json();
      setDnsCheckResult(data);

      if (data.isPosseVerified) {
        setDnsVerified(true);
      } else {
        setDnsError(
          "Entrada TXT ainda não detectada nos servidores DNS. Se acabou de cadastrar no Registro.br/Cloudflare, aguarde 1 a 2 minutos para propagação e clique novamente em Verificar."
        );
      }
    } catch {
      setDnsError("Erro ao consultar servidores DNS.");
    } finally {
      setIsCheckingDns(false);
    }
  };

  const getPaymentApiUrl = () => {
    if (typeof window !== "undefined") {
      if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
        return "http://localhost:3003";
      }
    }
    return (process.env.NEXT_PUBLIC_PAYMENT_API_URL || "http://localhost:3003").replace(/\/+$/, "");
  };

  const getExplorerInfo = (chainId: number, txHash: string) => {
    if (chainId === 421614) {
      return {
        name: "Arbitrum Sepolia",
        url: `https://sepolia.arbiscan.io/tx/${txHash}`,
      };
    }
    if (chainId === 80002) {
      return {
        name: "Polygon Amoy",
        url: `https://amoy.polygonscan.com/tx/${txHash}`,
      };
    }
    if (chainId === 31337) {
      return {
        name: "Anvil Local",
        url: process.env.NEXT_PUBLIC_RPC_URL || "http://localhost:55443",
      };
    }
    return {
      name: "Base Sepolia",
      url: `https://sepolia.basescan.org/tx/${txHash}`,
    };
  };

  // Polling para status de pagamento PIX / Cartão
  useEffect(() => {
    if (!isPollingPix || !pixOrder?.orderId || stage !== "onchain") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${getPaymentApiUrl()}/api/v1/checkout/status/${pixOrder.orderId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === "PAID" && data.txHash) {
          setIsPollingPix(false);
          const exp = getExplorerInfo(targetChainId, data.txHash);
          setOnChainData({
            txHash: data.txHash,
            basescanUrl: exp.url,
            publicKey: "0xProtocolSettledIdentity",
            network: exp.name,
            endpointUrl: `https://${domainName.trim().toLowerCase()}/api/maivw`,
            oracleAttestationVerified: true,
            domainId: data.domainId || user?.domainId || 1,
          });
          setStage("complete");
        }
      } catch {
        // Polling silencioso
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isPollingPix, pixOrder, stage, targetChainId, domainName, user]);

  const handleCreatePix = async () => {
    setIsCreatingPayment(true);
    setPaymentError(null);
    try {
      const res = await fetch(`${getPaymentApiUrl()}/api/v1/checkout/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: domainName.trim().toLowerCase(),
          userId: user?.id || 1,
          method: "pix",
          targetChainId,
          customerEmail: user?.email,
          customerName: user?.displayName || user?.email,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPaymentError(data.error || "Erro ao gerar PIX");
        return;
      }
      setPixOrder({
        orderId: data.orderId,
        pixQrCode: data.pixQrCode,
        pixCopyPaste: data.pixCopyPaste,
        amountBrl: data.amountBrl,
        amountUsd: data.amountUsd,
        isTestnet: !!data.isTestnet,
      });
      setIsPollingPix(true);
    } catch {
      setPaymentError("Não foi possível conectar ao microsserviço de pagamento.");
    } finally {
      setIsCreatingPayment(false);
    }
  };

  const handleConfirmTestnet = async (orderId: string) => {
    setIsSimulatingPayment(true);
    setPaymentError(null);
    try {
      const res = await fetch(`${getPaymentApiUrl()}/api/v1/checkout/testnet-confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPaymentError(data.error || data.message || "Falha ao simular pagamento");
        return;
      }
      const exp = getExplorerInfo(targetChainId, data.txHash);
      setOnChainData({
        txHash: data.txHash,
        basescanUrl: exp.url,
        publicKey: "0xProtocolSettledIdentity",
        network: exp.name,
        endpointUrl: `https://${domainName.trim().toLowerCase()}/api/maivw`,
        oracleAttestationVerified: true,
        domainId: data.domainId || user?.domainId || 1,
      });
      setStage("complete");
    } catch {
      setPaymentError("Erro ao confirmar pagamento de testnet.");
    } finally {
      setIsSimulatingPayment(false);
    }
  };

  const handleApplyVoucher = async () => {
    if (!voucherCode.trim()) {
      setPaymentError("Insira a chave do voucher corporativo.");
      return;
    }
    setIsCreatingPayment(true);
    setPaymentError(null);
    setVoucherSuccess(null);
    try {
      const res = await fetch(`${getPaymentApiUrl()}/api/v1/checkout/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: domainName.trim().toLowerCase(),
          userId: user?.id || 1,
          method: "voucher",
          licenseKey: voucherCode.trim(),
          targetChainId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPaymentError(data.error || "Voucher inválido ou cota esgotada.");
        return;
      }
      setVoucherSuccess(data.message || "Licença corporativa validada com sucesso!");
      const exp = getExplorerInfo(targetChainId, data.txHash);
      setOnChainData({
        txHash: data.txHash,
        basescanUrl: exp.url,
        publicKey: "0xProtocolSettledIdentity",
        network: exp.name,
        endpointUrl: `https://${domainName.trim().toLowerCase()}/api/maivw`,
        oracleAttestationVerified: true,
        domainId: data.domainId || user?.domainId || 1,
      });
      setTimeout(() => {
        setStage("complete");
      }, 1000);
    } catch {
      setPaymentError("Erro ao validar licença corporativa.");
    } finally {
      setIsCreatingPayment(false);
    }
  };

  const handleCreateCardOrder = async () => {
    setIsCreatingPayment(true);
    setPaymentError(null);
    try {
      const res = await fetch(`${getPaymentApiUrl()}/api/v1/checkout/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: domainName.trim().toLowerCase(),
          userId: user?.id || 1,
          method: "card",
          targetChainId,
          customerEmail: user?.email,
          customerName: user?.displayName || user?.email,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPaymentError(data.error || "Erro ao criar sessão de cartão");
        return;
      }
      setCardOrder({
        orderId: data.orderId,
        checkoutUrl: data.checkoutUrl,
        amountUsd: data.amountUsd,
        isTestnet: !!data.isTestnet,
      });
      setIsPollingPix(true);
    } catch {
      setPaymentError("Falha ao comunicar com o servidor de cartão.");
    } finally {
      setIsCreatingPayment(false);
    }
  };

  const handleConnectWeb3 = async () => {
    setIsConnectingWeb3(true);
    setPaymentError(null);
    try {
      const address = await connectWeb3Wallet();
      setWeb3WalletAddress(address);
    } catch (err: any) {
      setPaymentError(err?.message || "Falha ao conectar carteira Web3");
    } finally {
      setIsConnectingWeb3(false);
    }
  };

  const retryPendingRegistration = async () => {
    if (!pendingRegistration) return;
    setIsRegisteringOnChain(true);
    try {
      const res = await fetch(`${gatewayUrl}/api/v1/onboarding/finalize-web3-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user?.token || localStorage.getItem("maivw_token") || ""}` },
        body: JSON.stringify(pendingRegistration),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Confirmação ainda indisponível");
      setOnChainData({ ...data.blockchain, domainId: data.domain.id });
      setPendingRegistration(null);
      setStage("complete");
    } catch (error: any) {
      setOnChainError(`${error.message}. Clique novamente para conferir a mesma transação.`);
    } finally { setIsRegisteringOnChain(false); }
  };

  const handleRegisterWeb3Direct = async () => {
    if (pendingRegistration) return retryPendingRegistration();
    if (!challengeToken || !user?.id) return;

    const trimmedEndpoint = isCloudInstallation ? "" : p2pEndpoint.trim();
    if (!isCloudInstallation && !validateP2pEndpoint(trimmedEndpoint)) return;
    setP2pEndpointError(null);

    setIsRegisteringWeb3Direct(true);
    setPaymentError(null);
    setStepperStep(1);
    setWeb3StatusStep("Validando posse do domínio no DNS...");

    try {
      // 1. Obter ou verificar endereço da carteira Web3
      let caller = web3WalletAddress;
      if (!caller) {
        setWeb3StatusStep("Conectando à sua carteira Web3...");
        caller = await connectWeb3Wallet();
        setWeb3WalletAddress(caller);
      }

      // 2. Chamar o Gateway para obter a Prova do Oráculo (ECDSA) autorizando msg.sender = caller
      setStepperStep(2);
      setWeb3StatusStep("Solicitando atestado criptográfico ECDSA do Oráculo...");
      const proofRes = await fetch(`${gatewayUrl}/api/v1/onboarding/claim-proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user?.token || localStorage.getItem("maivw_token") || ""}` },
        body: JSON.stringify({
          domainName: domainName.trim().toLowerCase(),
          userId: user.id,
          token: challengeToken,
          callerAddress: caller,
          endpointUrl: isCloudInstallation ? undefined : (trimmedEndpoint || undefined),
          targetChainId,
        }),
      });

      const proofData = await proofRes.json();
      if (!proofRes.ok) {
        throw new Error(proofData.message || proofData.error || "Erro ao obter Prova do Oráculo");
      }

      // 3. Garantir que a carteira está conectada à rede correta
      setStepperStep(3);
      setWeb3StatusStep(`Alternando carteira para a rede ${proofData.network}...`);
      await ensureWalletChain(proofData.chainId);

      // 4. Codificar a função registerCompany com a prova emitida pelo Oráculo
      setWeb3StatusStep("Aguardando confirmação e assinatura na sua carteira...");
      const callData = encodeRegisterCompanyCall({
        domain: proofData.domain,
        endpoint: proofData.endpointUrl,
        publicKey: proofData.publicKey as `0x${string}`,
        adminKey: (proofData.adminKey || caller) as `0x${string}`,
        isProvider: false,
        deadline: proofData.deadline ? BigInt(proofData.deadline) : undefined,
        oracleProof: proofData.oracleProof as `0x${string}`,
      });

      // 5. Enviar transação nativa da carteira com o stake e taxa da rede
      const txHash = await sendWeb3Transaction({
        from: caller as `0x${string}`,
        to: proofData.contractAddress as `0x${string}`,
        data: callData,
        valueWei: proofData.standardFeeWei,
      });

      setPendingRegistration({ domainId: proofData.domainId, txHash, endpointUrl: proofData.endpointUrl, targetChainId: proofData.chainId });

      // 6. Finalizar e ancorar o registro no Gateway
      setStepperStep(4);
      setWeb3StatusStep("Confirmando registro e ancoragem do domínio...");
      const finalizeRes = await fetch(`${gatewayUrl}/api/v1/onboarding/finalize-web3-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user?.token || localStorage.getItem("maivw_token") || ""}` },
        body: JSON.stringify({
          domainId: proofData.domainId,
          txHash,
          endpointUrl: isCloudInstallation ? undefined : (trimmedEndpoint || undefined),
          targetChainId: proofData.chainId,
        }),
      });

      const finalizeData = await finalizeRes.json();
      if (!finalizeRes.ok) {
        throw new Error(finalizeData.message || finalizeData.error || "Falha ao finalizar registro pós-transação");
      }

      setPendingRegistration(null);
      setOnChainData({
        txHash: finalizeData.blockchain.txHash,
        basescanUrl: finalizeData.blockchain.basescanUrl,
        publicKey: finalizeData.blockchain.publicKey,
        network: finalizeData.blockchain.network,
        endpointUrl: finalizeData.blockchain.endpointUrl || trimmedEndpoint,
        oracleAttestationVerified: finalizeData.blockchain.oracleAttestationVerified,
        domainId: finalizeData.domain.id,
      });

      setStage("complete");
    } catch (err: any) {
      console.error("[WEB3-DIRECT-REGISTRATION] Error:", err);
      const msg = err?.message || "Falha ao registrar diretamente via Web3.";
      setPaymentError(msg);
      setStepperStep(0);
    } finally {
      setIsRegisteringWeb3Direct(false);
      setWeb3StatusStep(null);
    }
  };

  // STAGE: ON-CHAIN REGISTRATION
  const handleRegisterOnChain = async () => {
    if (pendingRegistration) return retryPendingRegistration();
    if (!challengeToken || !user?.id) return;

    const trimmedEndpoint = isCloudInstallation ? "" : p2pEndpoint.trim();
    if (!isCloudInstallation && !validateP2pEndpoint(trimmedEndpoint)) return;
    setP2pEndpointError(null);

    setIsRegisteringOnChain(true);
    setOnChainError(null);
    setStepperStep(1);

    try {
      // 1. Validação DNS
      setStepperStep(1);
      await new Promise((r) => setTimeout(r, 400));

      // 2. Atestação do Oráculo
      setStepperStep(2);
      await new Promise((r) => setTimeout(r, 400));

      // 3. Registro On-Chain via Relayer
      setStepperStep(3);

      const res = await fetch(`${gatewayUrl}/api/v1/onboarding/verify-and-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${user?.token || localStorage.getItem("maivw_token") || ""}` },
        body: JSON.stringify({
          domainName: domainName.trim().toLowerCase(),
          userId: user.id,
          token: challengeToken,
          challengeId: challengeId || undefined,
          targetNetwork: selectedOriginNetwork,
          endpointUrl: isCloudInstallation ? undefined : (trimmedEndpoint || undefined),
          targetChainId: selectedOriginNetwork !== "solana" ? targetChainId : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.txHash && data.domainId) setPendingRegistration({ domainId: data.domainId, txHash: data.txHash, endpointUrl: trimmedEndpoint || p2pEndpoint, targetChainId });
        setOnChainError(data.message || data.error || "Falha na transação on-chain");
        setStepperStep(0);
        return;
      }

      // 4. Conclusão & Ancoragem
      setStepperStep(4);
      await new Promise((r) => setTimeout(r, 300));

      setOnChainData({
        txHash: data.blockchain.txHash,
        basescanUrl: data.blockchain.basescanUrl,
        publicKey: data.blockchain.publicKey,
        network: data.blockchain.network,
        endpointUrl: data.blockchain.endpointUrl || trimmedEndpoint,
        oracleAttestationVerified: data.blockchain.oracleAttestationVerified,
        domainId: data.domain.id,
      });

      setStage("complete");
    } catch {
      setOnChainError("Erro ao submeter registro na blockchain.");
      setStepperStep(0);
    } finally {
      setIsRegisteringOnChain(false);
    }
  };



  // Pipeline stages configuration
  const stages: { id: Stage; label: string; icon: React.ReactNode }[] = [
    { id: "domain", label: "Domínio", icon: <Globe className="w-4 h-4" /> },
    { id: "dns", label: "Verificar DNS", icon: <Lock className="w-4 h-4" /> },
    { id: "onchain", label: "Ativação & Pagamento", icon: <ShieldCheck className="w-4 h-4" /> },
    { id: "complete", label: "Conclusão", icon: <CheckCircle2 className="w-4 h-4" /> },
  ];

  const stageOrder: Record<Stage, number> = {
    domain: 1,
    dns: 2,
    onchain: 3,
    complete: 4,
  };

  const currentStageIndex = stageOrder[stage];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#070101] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-red-500/30 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070101] text-slate-100 flex flex-col justify-between selection:bg-[#7d0000] selection:text-white relative overflow-hidden">
      {/* Ambient background light */}
      <div className="absolute top-0 right-1/4 w-[500px] h-[500px] bg-[#7d0000]/10 rounded-full blur-[160px] pointer-events-none" />
      <div className="absolute bottom-10 left-10 w-[400px] h-[400px] bg-[#3a0000]/15 rounded-full blur-[140px] pointer-events-none" />

      {/* Top Header */}
      <header className="border-b border-white/[0.06] bg-[#0c0808]/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#7d0000] to-[#3a0000] p-[1px] shadow-lg shadow-red-950/40 flex items-center justify-center group-hover:scale-105 transition">
                <div className="w-full h-full bg-[#0a0505] rounded-[11px] flex items-center justify-center p-1.5">
                  <img src="/logo-mw-badge.png" alt="MAIVW" className="w-full h-full object-contain rounded-md" />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-extrabold tracking-tight text-white">MAIVW</span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                    Configuração de Domínio
                  </span>
                </div>
              </div>
            </Link>
          </div>

          {/* Right Header: Logged User info */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs text-neutral-300">
              <UserCheck className="w-3.5 h-3.5 text-red-400" />
              <span className="truncate max-w-[180px] font-medium">{user?.email}</span>
            </div>

            <button
              type="button"
              onClick={() => {
                logout();
                router.push("/login");
              }}
              title="Sair"
              className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-white/[0.05] transition cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-8 flex flex-col justify-center relative z-10">
        {/* Sleek Stage Pipeline (No ugly step numbers) */}
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2 sm:gap-3 overflow-x-auto pb-2">
            {stages.map((st, idx) => {
              const itemIndex = stageOrder[st.id];
              const isActive = stage === st.id;
              const isPast = currentStageIndex > itemIndex;

              return (
                <React.Fragment key={st.id}>
                  <div
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${isActive
                      ? "bg-red-950/80 text-white border border-red-600/60 shadow-lg shadow-red-950/50 scale-102"
                      : isPast
                        ? "bg-emerald-950/30 text-emerald-400 border border-emerald-500/30"
                        : "bg-white/[0.03] text-neutral-500 border border-white/[0.06]"
                      }`}
                  >
                    <span className="shrink-0">
                      {isPast ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : st.icon}
                    </span>
                    <span className="hidden sm:inline">{st.label}</span>
                  </div>

                  {idx < stages.length - 1 && (
                    <div
                      className={`w-4 sm:w-6 h-[1px] transition-colors ${currentStageIndex > idx + 1 ? "bg-emerald-500/40" : "bg-white/[0.08]"
                        }`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* ========================================================== */}
        {/* STAGE: CONECTAR DOMÍNIO CORPORATIVO                        */}
        {/* ========================================================== */}
        {stage === "domain" && (
          <div className="bg-[#0f0909]/90 border border-white/[0.08] rounded-3xl p-6 md:p-10 shadow-2xl backdrop-blur-xl relative overflow-hidden">
            <div className="max-w-lg mx-auto relative z-10">
              <div className="text-center mb-8">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#7d0000] to-[#400000] p-[1px] inline-flex items-center justify-center mb-4 shadow-xl shadow-red-950/40">
                  <div className="w-full h-full bg-[#120808] rounded-[15px] flex items-center justify-center text-red-400">
                    <Globe className="w-6 h-6" />
                  </div>
                </div>
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  Conectar Domínio
                </h1>
                <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
                  Informe o domínio da sua empresa para verificarmos sua posse e emitir sua identidade.
                </p>
              </div>

              <form onSubmit={handleGenerateChallenge} className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-neutral-300 mb-2">
                    Nome do Domínio (FQDN)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={domainName}
                      onChange={(e) => setDomainName(e.target.value.toLowerCase().trim())}
                      placeholder="minhaempresa.com.br"
                      required
                      autoFocus
                      className="w-full px-4 py-3 pl-11 bg-[#150d0d] border border-white/[0.09] rounded-xl text-sm font-medium text-white placeholder-neutral-600 focus:outline-none focus:border-[#7d0000] focus:ring-1 focus:ring-[#7d0000] transition"
                    />
                    <Globe className="w-4 h-4 text-neutral-500 absolute left-3.5 top-3.5" />
                  </div>
                </div>

                <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-2xl space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-semibold text-red-300">
                    <Lock className="w-3.5 h-3.5 text-red-400" />
                    <span>Verificação de Segurança</span>
                  </div>
                  <p className="text-xs text-neutral-400 leading-relaxed">
                    Para garantir a segurança, geraremos um código rápido de verificação para adicionar no DNS do seu domínio.
                  </p>
                </div>

                {/* Opções de Rede de Ancoragem (Discreto) */}
                <div className="pt-0.5">
                  <div className="flex items-center justify-between text-xs px-1">
                    <span className="text-neutral-400 text-[11px] flex items-center gap-1.5">
                      <Network className="w-3.5 h-3.5 text-neutral-500" />
                      <span>Rede de Ancoragem:</span>
                      <span className="text-neutral-200 font-semibold">
                        {ORIGIN_NETWORK_OPTIONS.find((o) => o.key === selectedOriginNetwork)?.name || "Base"}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNetworkPicker(!showNetworkPicker)}
                      className="text-neutral-400 hover:text-white transition text-[11px] underline underline-offset-4 cursor-pointer flex items-center gap-1"
                    >
                      <span>{showNetworkPicker ? "Ocultar opções" : "Alterar rede"}</span>
                      <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showNetworkPicker ? "rotate-180" : ""}`} />
                    </button>
                  </div>

                  {showNetworkPicker && (
                    <div className="mt-2.5 p-2.5 bg-black/50 border border-white/[0.08] rounded-xl space-y-2 animate-in fade-in duration-200">
                      <div className="text-[10px] uppercase font-semibold tracking-wider text-neutral-500 px-1">
                        Selecione a rede de registro (Cartório On-Chain)
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {ORIGIN_NETWORK_OPTIONS.map((net) => {
                          const isSelected = selectedOriginNetwork === net.key;
                          return (
                            <button
                              key={net.key}
                              type="button"
                              onClick={() => {
                                setSelectedOriginNetwork(net.key);
                                if (net.chainId) {
                                  setTargetChainId(net.chainId);
                                }
                              }}
                              className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all ${
                                isSelected
                                  ? "bg-red-950/30 border-red-500/60 ring-1 ring-red-500/40 text-white shadow-md shadow-red-950/40"
                                  : "bg-white/[0.02] border-white/[0.06] text-neutral-300 hover:border-white/20 hover:bg-white/[0.04]"
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-xs text-white">{net.name}</span>
                                <span
                                  className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                                    isSelected
                                      ? "bg-red-500/20 text-red-300 border border-red-500/30"
                                      : "bg-white/[0.06] text-neutral-400"
                                  }`}
                                >
                                  {net.badge}
                                </span>
                              </div>
                              <div className="text-[10px] text-neutral-400 mt-1 line-clamp-1 leading-tight">
                                {net.desc}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {selectedOriginNetwork === "solana" && nodeMode && !nodeMode.solanaEnabled && (
                  <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300">
                    <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>A rede Solana não está ativa neste nó. Ative SOLANA_ENABLED no .env ou selecione outra rede de ancoragem.</span>
                  </div>
                )}

                {isSovereignInstallation && selectedOriginNetwork === "solana" && (
                  <div className="pt-0.5 text-left">
                    <button
                      type="button"
                      onClick={() => setShowSolanaAdvanced(!showSolanaAdvanced)}
                      className="text-[11px] text-neutral-400 hover:text-neutral-200 inline-flex items-center gap-1 cursor-pointer transition"
                    >
                      <span>Opções avançadas (Solana)</span>
                      <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showSolanaAdvanced ? "rotate-180" : ""}`} />
                    </button>
                    {showSolanaAdvanced && (
                      <div className="mt-2 p-3 bg-black/40 border border-white/[0.08] rounded-xl space-y-1.5 text-xs">
                        <label className="text-[11px] text-neutral-400 block font-medium">
                          Pubkey Solana do Registrante (Opcional):
                        </label>
                        <input
                          type="text"
                          value={customSolanaPubkey}
                          onChange={(e) => setCustomSolanaPubkey(e.target.value.trim())}
                          placeholder="Ex: 7gP5KaqYC... (deixe em branco para gerar via KMS do nó)"
                          className="w-full bg-black/60 border border-white/[0.1] rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-red-500/60"
                        />
                        <p className="text-[10px] text-neutral-500">
                          Deixe em branco para que o nó gere e guarde uma chave criptográfica Ed25519 no cofre seguro.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {domainError && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-300">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{domainError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isGeneratingChallenge || !domainName.includes(".")}
                  className={`w-full py-3.5 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-lg ${!isGeneratingChallenge && domainName.includes(".")
                    ? "bg-gradient-to-r from-[#7d0000] to-[#a30000] hover:from-[#900000] hover:to-[#b80000] text-white shadow-red-950/50 active:scale-[0.98]"
                    : "bg-white/[0.04] text-neutral-500 border border-white/[0.06] cursor-not-allowed"
                    }`}
                >
                  {isGeneratingChallenge ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Gerando Desafio Criptográfico...</span>
                    </>
                  ) : (
                    <>
                      <span>Gerar Registros DNS &amp; Prosseguir</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ========================================================== */}
        {/* STAGE: CONFIGURAÇÃO DE DNS & PROVA DE POSSE                */}
        {/* ========================================================== */}
        {stage === "dns" && (
          <div className="bg-[#0f0909]/90 border border-white/[0.08] rounded-3xl p-8 md:p-10 shadow-2xl backdrop-blur-xl">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between pb-6 border-b border-white/[0.06] gap-4">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold mb-2">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Prova de Posse Obrigatória</span>
                </div>
                <h1 className="text-2xl font-bold text-white tracking-tight">
                  Configuração de DNS para <span className="text-red-400 font-mono">{domainName}</span>
                </h1>
                <p className="text-xs text-neutral-400 mt-1">
                  Adicione a entrada TXT no seu provedor de DNS para comprovar titularidade exclusiva antes do registro on-chain.
                </p>
              </div>

              {dnsVerified && (
                <div className="flex items-center gap-2 px-3.5 py-1.5 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-xs font-bold shadow-lg shadow-emerald-950/40">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Posse Verificada com Sucesso!</span>
                </div>
              )}
            </div>

            {/* Cloudflare Quick Action Banner */}
            <div className="mt-6 p-4 rounded-2xl bg-gradient-to-r from-orange-950/30 via-[#180e0a] to-[#120a0a] border border-orange-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400 shrink-0">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    <span>Usa Cloudflare neste domínio?</span>
                    <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-bold">
                      1-Clique
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-400 mt-0.5">
                    Abra o painel DNS da Cloudflare com os dados pré-preenchidos e assistente guiado.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleOpenCloudflareForTxt}
                className="w-full sm:w-auto px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-black font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition shadow-lg shadow-orange-950/50 cursor-pointer active:scale-95 shrink-0"
              >
                <Cloud className="w-4 h-4" />
                <span>⚡ Abrir & Configurar na Cloudflare</span>
                <ExternalLink className="w-3.5 h-3.5 opacity-80" />
              </button>
            </div>

            {/* ONLY TXT PROOF RECORD */}
            <div className="mt-6">
              {records && (
                <div className="p-4 sm:p-5 bg-gradient-to-br from-red-950/40 via-[#140a0a] to-[#0a0505] border-2 border-red-600/50 rounded-2xl relative overflow-hidden shadow-xl">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-red-500/20 gap-2 mb-4">
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded bg-red-600 text-white font-mono text-xs font-bold shadow">
                        TXT
                      </span>
                      <span className="text-sm font-bold text-red-200">
                        Verificação de Titularidade (DNS TXT)
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider flex items-center gap-1">
                      Obrigatório para Ativar
                    </span>
                  </div>

                  <p className="text-xs text-neutral-300 mb-4 leading-relaxed">
                    Insira este registro TXT no painel de DNS do seu domínio <b className="text-white">{domainName}</b> para comprovar que você é o proprietário legítimo.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-neutral-400 text-[11px] font-medium">Nome / Host:</span>
                        <span className="text-[10px] text-neutral-500 font-mono">Cloudflare: {records.txt.name}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-[#0a0505] border border-white/[0.1] rounded-xl font-mono text-neutral-200">
                        <span className="truncate">{records.txt.host}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(records.txt.host, "txt_host")}
                          className="p-1 hover:text-red-400 transition cursor-pointer"
                          title="Copiar Host"
                        >
                          {copiedKey === "txt_host" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-neutral-400 text-[11px] font-medium">Valor / Conteúdo:</span>
                        {copiedKey === "cf_txt_auto" && (
                          <span className="text-[10px] text-emerald-400 font-bold animate-pulse">Copiado p/ Área de Transferência!</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between p-3 bg-[#0a0505] border border-red-500/30 rounded-xl font-mono text-red-300">
                        <span className="truncate max-w-[200px] sm:max-w-none">{records.txt.value}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(records.txt.value, "txt_val")}
                          className="p-1 hover:text-red-400 transition cursor-pointer"
                          title="Copiar Valor"
                        >
                          {copiedKey === "txt_val" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-red-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-neutral-400">
                    <span>TTL recomendado: <b>Auto</b> ou <b>300s (5 minutos)</b></span>
                    <span className="text-neutral-400 bg-white/[0.03] px-2.5 py-1 rounded-lg border border-white/[0.06]">
                      {selectedOriginNetwork === "solana"
                        ? "ℹ️ Prova canônica Solana vinculada por TXT criptográfico."
                        : "ℹ️ Registros adicionais de e-mail (MX / SPF) estarão disponíveis após a ativação."}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {dnsError && (
              <div className="mt-4 flex items-center gap-2 p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{dnsError}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-white/[0.06]">
              <button
                type="button"
                onClick={() => setStage("domain")}
                className="w-full sm:w-auto px-4 py-2.5 text-xs font-semibold text-neutral-400 hover:text-white transition cursor-pointer text-center"
              >
                ← Alterar Domínio
              </button>

              <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => handleCheckDns()}
                  disabled={isCheckingDns}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-red-700/50 bg-red-950/40 hover:bg-red-900/50 text-xs font-semibold text-red-200 transition flex items-center justify-center gap-2 cursor-pointer shadow-md"
                >
                  {isCheckingDns ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-red-400" />
                      <span>Verificando DNS...</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Verificar DNS</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setStage("onchain")}
                  disabled={!dnsVerified}
                  className={`w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-lg ${dnsVerified
                    ? "bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white shadow-emerald-950/60 active:scale-95"
                    : "bg-white/[0.04] text-neutral-500 border border-white/[0.06] cursor-not-allowed"
                    }`}
                >
                  <span>Prosseguir para Ativação</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================== */}
        {/* STAGE: REGISTRO NO CARTÓRIO ON-CHAIN                       */}
        {/* ========================================================== */}
        {/* ========================================================== */}
        {/* STAGE: REGISTRO NO CARTÓRIO ON-CHAIN & LIQUIDAÇÃO / PAGAMENTO */}
        {/* ========================================================== */}
        {stage === "onchain" && (
          <div className="bg-[#0f0909]/90 border border-white/[0.08] rounded-3xl p-6 sm:p-10 shadow-2xl backdrop-blur-xl relative overflow-hidden">
            <div className="max-w-2xl mx-auto text-center">
              {isSelfHosted ? (
                <>
                  {/* Badge & Title (Self-Hosted Mode) */}
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-600/20 to-blue-600/20 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400 mb-4 shadow-xl">
                    <ShieldCheck className="w-7 h-7" />
                  </div>
                  <h1 className="text-2xl font-bold text-white tracking-tight">
                    Ativação no Cartório On-Chain
                  </h1>
                  <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
                    A posse do domínio <span className="font-mono text-white font-bold">{domainName}</span> foi comprovada via DNS mundial. Escolha abaixo como deseja ancorar sua identidade criptográfica na blockchain.
                  </p>

                  {/* Trust & Network Badges Bar */}
                  <div className="my-6 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs text-left">
                    <div className="p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-white text-[11px]">Chaves Locais (KMS)</div>
                        <div className="text-[10px] text-neutral-400">ECDSA AES-256 no seu cofre</div>
                      </div>
                    </div>

                    <div className="p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
                        <Zap className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-white text-[11px]">Camada 2 (Base)</div>
                        <div className="text-[10px] text-neutral-400">Finalidade em ~2 segundos</div>
                      </div>
                    </div>

                    <div className="p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-white text-[11px]">Identidade Soberana</div>
                        <div className="text-[10px] text-neutral-400">Anti-spoofing garantido</div>
                      </div>
                    </div>
                  </div>

                  {/* Summary Bar */}
                  <div className="mb-6 p-4 bg-[#0a0505] border border-white/[0.08] rounded-2xl text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-neutral-400" />
                      <span className="text-neutral-400">Domínio Titular:</span>
                      <span className="font-mono text-white font-semibold">{domainName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold text-[11px]">
                        DNS Validado ✓
                      </span>
                      <span className="px-2.5 py-1 rounded-full bg-white/[0.04] text-neutral-300 border border-white/[0.08] text-[11px] font-mono">
                        {selectedOriginNetwork === "solana"
                          ? "Solana Devnet (Ed25519)"
                          : targetChainId === 84532
                          ? "Base Sepolia (84532)"
                          : targetChainId === 421614
                            ? "Arbitrum Sepolia (421614)"
                            : targetChainId === 80002
                              ? "Polygon Amoy (80002)"
                              : `Chain (${targetChainId})`}
                      </span>
                    </div>
                  </div>

                  {/* P2P Endpoint Inbound Configuration Box (Exibir apenas para instalação soberana, ocultar no Maivw Cloud) */}
                  {isSovereignInstallation && (
                    <div className="mb-6 p-4 bg-[#0a0505] border border-white/[0.08] rounded-2xl text-left space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Network className="w-4 h-4 text-blue-400" />
                          <span className="text-xs font-bold text-white">Endpoint de Recepção P2P</span>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono">
                          {endpointRequiresHttps ? "HTTPS obrigatório" : "HTTP local permitido"}
                        </span>
                      </div>
                      <div className="text-[11px] text-neutral-400">
                        Endereço onde este nó escutará entregas diretas de outros servidores e gateways da rede MAIVW:
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="text"
                          value={p2pEndpoint}
                          onChange={(e) => {
                            setP2pEndpoint(e.target.value);
                            if (p2pEndpointError) setP2pEndpointError(null);
                          }}
                          placeholder={nodeMode?.defaultEndpoint || `https://mw-p2p.${domainName || "empresa.com"}/api/v1/inbox`}
                          className="flex-1 bg-black/60 border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-xs font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-blue-500/60"
                        />
                        <button
                          type="button"
                          onClick={() => setP2pEndpoint(nodeMode?.defaultEndpoint || `https://mw-p2p.${domainName.trim().toLowerCase()}/api/v1/inbox`)}
                          className="px-3 py-2.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-neutral-300 rounded-xl text-xs font-medium cursor-pointer transition shrink-0"
                          title="Restaurar padrão"
                        >
                          Padrão
                        </button>
                      </div>
                      {p2pEndpointError && (
                        <div className="text-[11px] text-red-400 flex items-center gap-1.5 pt-1">
                          <AlertCircle className="w-3.5 h-3.5" />
                          <span>{p2pEndpointError}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Stepper Progress Bar (se estiver em execução) */}
                  {(isRegisteringOnChain || isRegisteringWeb3Direct || stepperStep > 0) && (
                    <div className="mb-6 p-4 bg-emerald-950/20 border border-emerald-500/30 rounded-2xl text-left space-y-3">
                      <div className="flex items-center justify-between text-xs font-bold text-white">
                        <span className="flex items-center gap-2 text-emerald-400">
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Executando Onboarding no Cartório On-Chain...</span>
                        </span>
                        <span className="text-neutral-400 font-mono text-[11px]">Passo {stepperStep} de 4</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        {[
                          { step: 1, label: "1. Checagem DNS", desc: "Token TXT validado" },
                          { step: 2, label: "2. Laudo Cripto", desc: "Oráculo autoriza" },
                          { step: 3, label: "3. Gravação On-Chain", desc: selectedOriginNetwork === "solana" ? "Solana Devnet" : "Base Sepolia" },
                          { step: 4, label: "4. Ancoragem", desc: "Chaves registradas" },
                        ].map((s) => {
                          const isDone = stepperStep > s.step;
                          const isCurrent = stepperStep === s.step;
                          return (
                            <div
                              key={s.step}
                              className={`p-2.5 rounded-xl border transition ${
                                isDone
                                  ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
                                  : isCurrent
                                  ? "bg-amber-500/10 border-amber-500/40 text-amber-200 ring-1 ring-amber-500/30"
                                  : "bg-white/[0.02] border-white/[0.06] text-neutral-500"
                              }`}
                            >
                              <div className="flex items-center gap-1.5 font-bold text-[11px]">
                                {isDone ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : isCurrent ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />
                                ) : (
                                  <span className="w-3.5 h-3.5 inline-block text-center text-[10px]">•</span>
                                )}
                                <span>{s.label}</span>
                              </div>
                              <div className="text-[10px] text-neutral-400 mt-0.5">{s.desc}</div>
                            </div>
                          );
                        })}
                      </div>
                      {web3StatusStep && (
                        <div className="text-xs text-amber-300 font-mono bg-black/40 p-2 rounded-lg border border-amber-500/20">
                          {web3StatusStep}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Error Alert */}
                  {(onChainError || paymentError) && (
                    <div className="flex items-center gap-2 p-3.5 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-300 text-left mb-6">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{onChainError || paymentError}</span>
                    </div>
                  )}

                  {/* Dual Mode Cards (Forma 1 e Forma 2) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left mb-6">
                    {/* CARD 1: FORMA 1 (Relayer / Rede Maivw) */}
                    <div className="p-5 rounded-2xl bg-gradient-to-b from-[#180e0e] to-[#0d0707] border border-red-500/40 relative shadow-xl shadow-red-950/20 flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="w-9 h-9 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 flex items-center justify-center shrink-0">
                            <Zap className="w-5 h-5" />
                          </div>
                          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-red-500/20 text-red-300 border border-red-500/40">
                            Recomendado • Instantâneo
                          </span>
                        </div>
                        <div>
                          <div className="text-sm font-bold text-white">
                            {selectedOriginNetwork === "solana"
                              ? "Forma 1: Modo Gerenciado (Relayer Solana)"
                              : "Forma 1: Modo Gerenciado (Rede Maivw)"}
                          </div>
                          <div className="text-xs text-neutral-400 mt-0.5">
                            {selectedOriginNetwork === "solana"
                              ? "Ativação rápida e assistida pelo Relayer Solana oficial da rede."
                              : "Ativação rápida e assistida pelo nó oráculo/relayer oficial da rede."}
                          </div>
                        </div>
                        <div className="space-y-1.5 text-xs text-neutral-300 pt-2 border-t border-white/[0.06]">
                          <div className="flex items-center gap-2">
                            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span>
                              {selectedOriginNetwork === "solana"
                                ? "Zero Cripto: Não requer carteira ou saldo em SOL"
                                : "Zero Cripto: Não requer carteira ou saldo em ETH"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span>
                              {selectedOriginNetwork === "solana"
                                ? "Gasless: Taxa de rede e transação SPL gerenciadas pelo nó"
                                : "Gasless: Taxa on-chain e gás patrocinados pela rede"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span>
                              {selectedOriginNetwork === "solana"
                                ? "Chave Ed25519 provisionada via KMS seguro do nó"
                                : "Ideal para colocar o nó no ar em segundos"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-5">
                        <button
                          type="button"
                          onClick={handleRegisterOnChain}
                          disabled={isRegisteringOnChain || isRegisteringWeb3Direct}
                          className="w-full py-3.5 px-4 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-red-950/60 transition cursor-pointer active:scale-[0.98]"
                        >
                          {isRegisteringOnChain ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              <span>{selectedOriginNetwork === "solana" ? "Ativando via Relayer Solana..." : "Ativando via Rede Maivw..."}</span>
                            </>
                          ) : (
                            <>
                              <Zap className="w-4 h-4" />
                              <span>{selectedOriginNetwork === "solana" ? "Ativar via Relayer Solana (Instantâneo)" : "Ativar via Rede Maivw (Instantâneo)"}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* CARD 2: FORMA 2 (Soberano / Web3 Direto) */}
                    <div className="p-5 rounded-2xl bg-gradient-to-b from-[#13111b] to-[#0b0a10] border border-blue-500/40 relative shadow-xl shadow-blue-950/20 flex flex-col justify-between">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
                            <Wallet className="w-5 h-5" />
                          </div>
                          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                            Soberania Total
                          </span>
                        </div>
                        <div>
                          <div className="text-sm font-bold text-white">
                            {selectedOriginNetwork === "solana"
                              ? "Forma 2: Modo Soberano (Carteira Solana)"
                              : "Forma 2: Modo Soberano (Web3 Direto)"}
                          </div>
                          <div className="text-xs text-neutral-400 mt-0.5">
                            {selectedOriginNetwork === "solana"
                              ? "Você assina a instrução de registro diretamente com Phantom ou Solflare."
                              : "Você assina a transação e paga a taxa diretamente com sua carteira."}
                          </div>
                        </div>
                        <div className="space-y-1.5 text-xs text-neutral-300 pt-2 border-t border-white/[0.06]">
                          <div className="flex items-center gap-2">
                            <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            <span>
                              {selectedOriginNetwork === "solana"
                                ? "Soberania: Sua carteira assina a OriginClaim Solana"
                                : "Soberania: Sua carteira submete o registerCompany()"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            <span>
                              {selectedOriginNetwork === "solana"
                                ? "Taxa da Rede: Taxa padrão SPL / SOL na Solana Devnet"
                                : "Taxa da Rede: 0.0001 ETH na Base Sepolia"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            <span>
                              {selectedOriginNetwork === "solana"
                                ? "Compatível com Phantom, Solflare e Backpack"
                                : "Compatível com MetaMask, Rabby e WalletConnect"}
                            </span>
                          </div>
                        </div>

                        {web3WalletAddress && (
                          <div className="p-2.5 bg-black/40 border border-white/[0.08] rounded-xl text-xs font-mono text-neutral-300 flex items-center justify-between">
                            <span className="text-neutral-500">Carteira Conectada:</span>
                            <span className="text-blue-400 font-bold">
                              {web3WalletAddress.slice(0, 6)}...{web3WalletAddress.slice(-4)}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="pt-5 space-y-2">
                        {!web3WalletAddress ? (
                          <button
                            type="button"
                            onClick={handleConnectWeb3}
                            disabled={isConnectingWeb3 || isRegisteringOnChain || isRegisteringWeb3Direct}
                            className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-950/60 transition cursor-pointer active:scale-[0.98]"
                          >
                            {isConnectingWeb3 ? (
                              <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <span>Conectando Carteira...</span>
                              </>
                            ) : (
                              <>
                                <Wallet className="w-4 h-4" />
                                <span>Conectar Carteira Web3</span>
                              </>
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleRegisterWeb3Direct}
                            disabled={isRegisteringOnChain || isRegisteringWeb3Direct}
                            className="w-full py-3.5 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-950/60 transition cursor-pointer active:scale-[0.98]"
                          >
                            {isRegisteringWeb3Direct ? (
                              <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <span>Assinando & Enviando...</span>
                              </>
                            ) : (
                              <>
                                <Sparkles className="w-4 h-4" />
                                <span>Assinar & Registrar On-Chain (0.0001 ETH)</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* Badge & Title (Cloud Billing Mode) */}
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-600/20 to-blue-600/20 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400 mb-4 shadow-xl">
                    <ShieldCheck className="w-7 h-7" />
                  </div>
                  <h1 className="text-2xl font-bold text-white tracking-tight">
                    Ativação & Registro Oficial
                  </h1>
                  <p className="text-xs text-neutral-400 mt-2 leading-relaxed">
                    Seu domínio <span className="font-mono text-white font-bold">{domainName}</span> foi validado com sucesso.
                    Conclua a ativação para emitir a certificação oficial (R$ 55,00 / $10 USD).
                  </p>

                  {/* Trust & Security Badges Bar */}
                  <div className="my-6 grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs text-left">
                    <div className="p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                        <Lock className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-white text-[11px]">Checkout Seguro</div>
                        <div className="text-[10px] text-neutral-400">Conexão HTTPS</div>
                      </div>
                    </div>

                    <div className="p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
                        <Zap className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-white text-[11px]">Confirmação na rede</div>
                        <div className="text-[10px] text-neutral-400">Ativação após confirmação da transação</div>
                      </div>
                    </div>

                    <div className="p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0">
                        <CheckCircle2 className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-white text-[11px]">Domínio Exclusivo</div>
                        <div className="text-[10px] text-neutral-400">Prova de posse e registro na rede</div>
                      </div>
                    </div>
                  </div>

                  {/* Summary Bar */}
                  <div className="mb-6 p-4 bg-[#0a0505] border border-white/[0.08] rounded-2xl text-left flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-neutral-400" />
                      <span className="text-neutral-400">Domínio a Ativar:</span>
                      <span className="font-mono text-white font-semibold">{domainName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold text-[11px]">
                        Posse Verificada ✓
                      </span>
                      <span className="px-2.5 py-1 rounded-full bg-white/[0.04] text-neutral-300 border border-white/[0.08] text-[11px] font-mono">
                        Taxa consultada na etapa Web3
                      </span>
                    </div>
                  </div>

                  <p className="mb-6 text-sm text-neutral-400">
                    PIX, cartão e voucher estão temporariamente indisponíveis. O registro por carteira Web3 exige um nó autorizado.
                  </p>

              {/* Error Alert */}
              {paymentError && (
                <div className="flex items-center gap-2 p-3.5 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-300 text-left mb-6">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{paymentError}</span>
                </div>
              )}

              {/* TAB 1: PIX */}
              {paymentMethod === "pix" && (
                <div className="p-6 bg-[#0c0606] border border-white/[0.08] rounded-2xl text-left space-y-4">
                  {!pixOrder ? (
                    <div className="text-center py-4 space-y-4">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                        <QrCode className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">Pagamento Instantâneo via PIX</div>
                        <div className="text-xs text-neutral-400 mt-1">
                          Valor total: <strong className="text-emerald-400">R$ 55,00</strong> (equivalente a $10.00 USD).
                        </div>
                        <div className="text-[11px] text-neutral-500 mt-0.5">
                          Processado via Asaas Gateway Transparente com ativação instantânea on-chain.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleCreatePix}
                        disabled={isCreatingPayment}
                        className="w-full sm:w-auto px-8 py-3.5 rounded-xl font-bold text-xs bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-xl shadow-emerald-950/60 inline-flex items-center justify-center gap-2 cursor-pointer transition active:scale-[0.98]"
                      >
                        {isCreatingPayment ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>Gerando QR Code PIX...</span>
                          </>
                        ) : (
                          <>
                            <QrCode className="w-4 h-4" />
                            <span>Gerar QR Code PIX (R$ 55,00)</span>
                          </>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row items-center gap-6">
                        {/* QR Code Canvas Frame */}
                        <div className="bg-white p-3 rounded-2xl shadow-xl shrink-0 flex items-center justify-center">
                          <img
                            src={pixOrder.pixQrCode}
                            alt="QR Code Pix"
                            className="w-44 h-44 object-contain rounded-lg"
                          />
                        </div>

                        {/* Details & Copy Paste */}
                        <div className="flex-1 w-full space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-neutral-400">Valor a Pagar:</span>
                            <span className="text-base font-extrabold text-emerald-400">
                              R$ {pixOrder.amountBrl.toFixed(2)}
                            </span>
                          </div>

                          <div>
                            <div className="text-[11px] text-neutral-400 mb-1">Código Pix Copia e Cola:</div>
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                readOnly
                                value={pixOrder.pixCopyPaste}
                                className="w-full bg-black/60 border border-white/[0.1] rounded-xl px-3 py-2 text-[11px] font-mono text-neutral-300 focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => copyToClipboard(pixOrder.pixCopyPaste, "pix_key")}
                                className="px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition shrink-0 cursor-pointer"
                              >
                                {copiedKey === "pix_key" ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>Copiado!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Copiar</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          <div className="p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl flex items-center gap-2.5 text-xs text-neutral-300">
                            <RefreshCw className="w-4 h-4 text-emerald-400 animate-spin shrink-0" />
                            <span>Aguardando confirmação bancária em tempo real...</span>
                          </div>
                        </div>
                      </div>

                      {/* Sandbox Simulated Testnet Button */}
                      {pixOrder.isTestnet && (
                        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Sparkles className="w-4 h-4 text-amber-400" />
                              <span className="text-xs font-bold text-amber-300">
                                Modo Testnet Sandbox Ativo
                              </span>
                            </div>
                            <span className="text-[10px] bg-amber-500/20 text-amber-200 px-2 py-0.5 rounded-full font-mono">
                              Sem cobrança real
                            </span>
                          </div>
                          <p className="text-[11px] text-neutral-400">
                            Você pode simular o pagamento imediatamente no ambiente de testes para emitir e ancorar a transação na blockchain.
                          </p>
                          <button
                            type="button"
                            onClick={() => handleConfirmTestnet(pixOrder.orderId)}
                            disabled={isSimulatingPayment}
                            className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.98]"
                          >
                            {isSimulatingPayment ? (
                              <>
                                <RefreshCw className="w-4 h-4 animate-spin" />
                                <span>Confirmando & Ancorando On-Chain...</span>
                              </>
                            ) : (
                              <>
                                <Zap className="w-4 h-4" />
                                <span>⚡ Confirmar Pagamento Simulado (Testnet Sandbox)</span>
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: CARTÃO DE CRÉDITO (STRIPE) */}
              {paymentMethod === "card" && (
                <div className="p-6 bg-[#0c0606] border border-white/[0.08] rounded-2xl text-left space-y-4">
                  <div className="text-center py-4 space-y-4">
                    <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mx-auto">
                      <CreditCard className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white">Cartão de Crédito Global (Stripe)</div>
                      <div className="text-xs text-neutral-400 mt-1">
                        Valor total: <strong className="text-white">$10.00 USD</strong>. Suporta Visa, Mastercard, Elo e Amex.
                      </div>
                      <div className="text-[11px] text-neutral-500 mt-0.5">
                        Transação protegida por criptografia de ponta a ponta com recibo automático.
                      </div>
                    </div>

                    {!cardOrder ? (
                      <button
                        type="button"
                        onClick={handleCreateCardOrder}
                        disabled={isCreatingPayment}
                        className="w-full sm:w-auto px-8 py-3.5 rounded-xl font-bold text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-xl shadow-blue-950/60 inline-flex items-center justify-center gap-2 cursor-pointer transition active:scale-[0.98]"
                      >
                        {isCreatingPayment ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>Iniciando Checkout Stripe...</span>
                          </>
                        ) : (
                          <>
                            <CreditCard className="w-4 h-4" />
                            <span>Pagar $10.00 USD com Cartão</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl space-y-2 text-left">
                        <div className="text-xs font-bold text-amber-300 flex items-center gap-2">
                          <Sparkles className="w-4 h-4" />
                          <span>Sessão de Cartão em Testnet Criada</span>
                        </div>
                        <p className="text-[11px] text-neutral-400">
                          ID do Pedido: <span className="font-mono text-white">{cardOrder.orderId}</span>
                        </p>
                        <button
                          type="button"
                          onClick={() => handleConfirmTestnet(cardOrder.orderId)}
                          disabled={isSimulatingPayment}
                          className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.98]"
                        >
                          {isSimulatingPayment ? (
                            <>
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              <span>Confirmando & Ancorando...</span>
                            </>
                          ) : (
                            <>
                              <Zap className="w-4 h-4" />
                              <span>⚡ Simular Pagamento do Cartão (Testnet Sandbox)</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: VOUCHER & LICENÇA B2B */}
              {paymentMethod === "voucher" && (
                <div className="p-6 bg-[#0c0606] border border-white/[0.08] rounded-2xl text-left space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center shrink-0">
                      <Ticket className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white">Chave de Licença Corporativa / Voucher B2B</div>
                      <div className="text-xs text-neutral-400">
                        Ativação direta com cota pré-paga para empresas parceiras.
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2">
                    <div>
                      <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
                        Código do Voucher ou Contrato:
                      </label>
                      <input
                        type="text"
                        value={voucherCode}
                        onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                        placeholder="Ex: MAIVW-ENTERPRISE-2026"
                        className="w-full bg-black/60 border border-white/[0.1] rounded-xl px-4 py-3 text-xs font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-purple-500/60"
                      />
                    </div>

                    {voucherSuccess && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>{voucherSuccess}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleApplyVoucher}
                      disabled={isCreatingPayment || !voucherCode.trim()}
                      className="w-full py-3.5 rounded-xl font-bold text-xs bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white shadow-xl shadow-purple-950/60 flex items-center justify-center gap-2 cursor-pointer transition active:scale-[0.98]"
                    >
                      {isCreatingPayment ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Validando Voucher & Ancorando...</span>
                        </>
                      ) : (
                        <>
                          <Ticket className="w-4 h-4" />
                          <span>Validar Voucher e Ativar Domínio</span>
                        </>
                      )}
                    </button>

                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-[11px] text-amber-300 flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>Para testes de sandbox/desenvolvimento, utilize o código: <b>TESTNET-FREE</b></span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: WEB3 DIRECT */}
              {paymentMethod === "web3" && (
                <div className="p-6 bg-[#0c0606] border border-white/[0.08] rounded-2xl text-left space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 flex items-center justify-center shrink-0">
                      <Wallet className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-sm font-bold text-white">Pagamento Direto via Carteira Web3</div>
                      <div className="text-xs text-neutral-400">
                        Pague a taxa de registro diretamente com MetaMask, Rabby ou WalletConnect.
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 bg-white/[0.02] border border-white/[0.06] rounded-xl text-xs text-neutral-300 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-400">Carteira Conectada:</span>
                      <span className="font-mono text-orange-400 font-semibold">
                        {web3WalletAddress
                          ? `${web3WalletAddress.slice(0, 6)}...${web3WalletAddress.slice(-4)}`
                          : "Nenhuma carteira conectada"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-neutral-400">Rede da Transação:</span>
                      <span className="font-semibold text-white">
                        {targetChainId === 84532
                          ? "Base Sepolia"
                          : targetChainId === 421614
                            ? "Arbitrum Sepolia"
                            : targetChainId === 80002
                              ? "Polygon Amoy"
                              : `Chain ${targetChainId}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between border-t border-white/[0.04] pt-1.5">
                      <span className="text-neutral-400">Taxa &amp; Stake:</span>
                      <span className="font-bold text-amber-400">
                        {targetChainId === 80002 ? "0.1 POL" : "0.0001 ETH"}
                      </span>
                    </div>
                  </div>

                  {web3StatusStep && (
                    <div className="p-3 bg-orange-500/10 border border-orange-500/20 rounded-xl flex items-center gap-2.5 text-xs text-orange-300 animate-pulse">
                      <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                      <span>{web3StatusStep}</span>
                    </div>
                  )}

                  {!web3WalletAddress ? (
                    <button
                      type="button"
                      onClick={handleConnectWeb3}
                      disabled={isConnectingWeb3}
                      className="w-full py-3.5 rounded-xl font-bold text-xs bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white shadow-xl shadow-orange-950/60 flex items-center justify-center gap-2 cursor-pointer transition active:scale-[0.98]"
                    >
                      {isConnectingWeb3 ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Conectando Carteira...</span>
                        </>
                      ) : (
                        <>
                          <Wallet className="w-4 h-4" />
                          <span>Conectar MetaMask / Rabby Wallet</span>
                        </>
                      )}
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={handleRegisterWeb3Direct}
                        disabled={isRegisteringWeb3Direct}
                        className="w-full py-3.5 rounded-xl font-bold text-xs bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white shadow-xl shadow-orange-950/60 flex items-center justify-center gap-2 cursor-pointer transition active:scale-[0.98] disabled:opacity-50"
                      >
                        {isRegisteringWeb3Direct ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin" />
                            <span>Processando Transação Web3...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4" />
                            <span>Assinar &amp; Ativar Domínio ({targetChainId === 80002 ? "0.1 POL" : "0.0001 ETH"})</span>
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Discrete Advanced Options Accordion */}
              <div className="mt-8 pt-4 border-t border-white/[0.06] text-left">
                <button
                  type="button"
                  onClick={() => setShowAdvancedPayment(!showAdvancedPayment)}
                  className="text-xs text-neutral-400 hover:text-neutral-200 inline-flex items-center gap-1.5 transition cursor-pointer"
                >
                  <span>Opções da carteira Web3 e rede</span>
                  {showAdvancedPayment ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showAdvancedPayment && (
                  <div className="mt-3 p-4 bg-white/[0.02] border border-white/[0.08] rounded-2xl space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentError("Provisionamento por voucher temporariamente indisponível.");
                        }}
                        className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer ${paymentMethod === "voucher"
                          ? "bg-amber-950/40 border-amber-500/50 text-amber-200"
                          : "bg-white/[0.02] border-white/[0.06] text-neutral-400 hover:text-white"
                          }`}
                      >
                        <Ticket className="w-4 h-4" />
                        <span>Voucher indisponível</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentMethod("web3");
                          setPaymentError(null);
                        }}
                        className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer ${paymentMethod === "web3"
                          ? "bg-blue-950/40 border-blue-500/50 text-blue-200"
                          : "bg-white/[0.02] border-white/[0.06] text-neutral-400 hover:text-white"
                          }`}
                      >
                        <Wallet className="w-4 h-4" />
                        <span>Carteira Web3 (Direct)</span>
                      </button>
                    </div>

                    {/* Network Switcher (only in advanced mode) */}
                    <div className="pt-2 border-t border-white/[0.06]">
                      <button
                        type="button"
                        onClick={() => setShowAdvancedNetwork(!showAdvancedNetwork)}
                        className="inline-flex items-center gap-1.5 text-[11px] text-neutral-400 hover:text-neutral-200 transition py-1 cursor-pointer"
                      >
                        <Network className="w-3.5 h-3.5 text-blue-400" />
                        <span>Alterar Blockchain de Ancoragem ({targetChainId === 84532 ? "Base Sepolia" : targetChainId === 421614 ? "Arbitrum Sepolia" : targetChainId === 80002 ? "Polygon Amoy" : `Chain ${targetChainId}`})</span>
                        {showAdvancedNetwork ? <ChevronUp className="w-3 h-3 text-neutral-400" /> : <ChevronDown className="w-3 h-3 text-neutral-400" />}
                      </button>

                      {showAdvancedNetwork && (
                        <div className="mt-2.5 p-3 bg-black/60 border border-white/[0.08] rounded-xl space-y-2 text-xs">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {[
                              { id: 84532, name: "Base Sepolia", desc: "L2 Coinbase • Padrão", badge: "Padrão" },
                              { id: 421614, name: "Arbitrum Sepolia", desc: "Nitro Rollup", badge: "Nitro" },
                              { id: 80002, name: "Polygon Amoy", desc: "AggLayer EVM", badge: "Amoy" },
                              { id: 31337, name: "Anvil Local", desc: "Ambiente local", badge: "Local" },
                            ].filter((net) => nodeMode?.chainId === 31337 ? true : net.id !== 31337).map((net) => (
                              <div
                                key={net.id}
                                onClick={() => setTargetChainId(net.id)}
                                className={`p-2.5 rounded-lg border cursor-pointer transition text-left ${targetChainId === net.id
                                  ? "bg-blue-950/40 border-blue-500/60 ring-1 ring-blue-500/40"
                                  : "bg-white/[0.02] border-white/[0.06] hover:border-white/20"
                                  }`}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-white text-[11px]">{net.name}</span>
                                  <span className="text-[9px] px-1 py-0.2 rounded bg-white/10 text-neutral-300 font-mono">
                                    {net.badge}
                                  </span>
                                </div>
                                <div className="text-[10px] text-neutral-400 mt-0.5">{net.desc}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    )}





        {/* ========================================================== */}
        {/* STAGE: DOMÍNIO REGISTRADO COM SUCESSO                     */}
        {/* ========================================================== */}
        {stage === "complete" && (
          <div className="bg-[#0f0909]/90 border border-white/[0.08] rounded-3xl p-6 sm:p-10 shadow-2xl backdrop-blur-xl space-y-8 relative overflow-hidden">
            {/* Header Success */}
            <div className="text-center max-w-lg mx-auto">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400 mb-4 shadow-xl shadow-emerald-950/40">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Domínio Registrado com Sucesso
              </h1>
              <p className="text-xs sm:text-sm text-neutral-400 mt-2 leading-relaxed">
                O domínio <span className="font-mono text-white font-bold">{domainName}</span> está autenticado e ancorado na rede descentralizada MAIVW.
              </p>
            </div>

            {/* On-Chain Identity Summary Card */}
            {onChainData && (
              <div className="max-w-2xl mx-auto p-5 bg-gradient-to-b from-[#130b0b] to-[#0a0505] border border-white/[0.1] rounded-2xl space-y-4 text-left shadow-lg">
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-white uppercase tracking-wider">Identidade On-Chain Registrada</span>
                  </div>
                  <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-mono font-semibold">
                    {onChainData.network || "Base Sepolia"}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {/* Public Key */}
                  <div className="p-3 bg-black/50 border border-white/[0.06] rounded-xl space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-neutral-400">
                      <span>{selectedOriginNetwork === "solana" ? "Chave Pública Solana (Ed25519):" : "Chave Pública ECDSA:"}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(onChainData.publicKey, "pk_receipt")}
                        className="hover:text-white transition flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === "pk_receipt" ? (
                          <span className="text-emerald-400 font-bold">Copiado!</span>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="font-mono text-[11px] text-neutral-200 truncate" title={onChainData.publicKey}>
                      {onChainData.publicKey}
                    </div>
                  </div>

                  {/* TX Hash */}
                  <div className="p-3 bg-black/50 border border-white/[0.06] rounded-xl space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-neutral-400">
                      <span>Transação Blockchain:</span>
                      {onChainData.basescanUrl || onChainData.txHash ? (
                        <a
                          href={
                            onChainData.basescanUrl ||
                            (selectedOriginNetwork === "solana"
                              ? `https://explorer.solana.com/tx/${onChainData.txHash}?cluster=devnet`
                              : `https://sepolia.basescan.org/tx/${onChainData.txHash}`)
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:text-blue-300 transition flex items-center gap-1"
                        >
                          <span>Explorer</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : null}
                    </div>
                    <div className="font-mono text-[11px] text-blue-300 truncate" title={onChainData.txHash}>
                      {onChainData.txHash}
                    </div>
                  </div>
                </div>

                {/* Discreet toggle for Solana Pubkey details if Solana */}
                {selectedOriginNetwork === "solana" && (
                  <div className="pt-2 border-t border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => setShowSolanaPubkeyReceipt(!showSolanaPubkeyReceipt)}
                      className="text-[11px] text-violet-300 hover:text-violet-200 inline-flex items-center gap-1.5 transition cursor-pointer"
                    >
                      <Lock className="w-3 h-3 text-violet-400" />
                      <span>{showSolanaPubkeyReceipt ? "Ocultar detalhes da chave Solana" : "Exibir Chave Criptográfica (Pubkey Solana)"}</span>
                      <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showSolanaPubkeyReceipt ? "rotate-180" : ""}`} />
                    </button>
                    {showSolanaPubkeyReceipt && (
                      <div className="mt-2.5 p-3.5 bg-black/60 border border-violet-500/30 rounded-xl space-y-2 text-xs animate-in fade-in duration-200">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-violet-300">Pubkey Registrant (Base58):</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(onChainData.publicKey, "sol_pk_full")}
                            className="text-neutral-400 hover:text-white flex items-center gap-1 text-[11px]"
                          >
                            {copiedKey === "sol_pk_full" ? <span className="text-emerald-400 font-bold">Copiado!</span> : <Copy className="w-3 h-3" />}
                          </button>
                        </div>
                        <div className="font-mono text-[11px] text-neutral-200 break-all p-2 bg-white/[0.03] rounded-lg border border-white/[0.06]">
                          {onChainData.publicKey}
                        </div>
                        <p className="text-[10px] text-neutral-400">
                          Esta chave Ed25519 é a titular canônica do domínio na Solana. A chave privada correspondente está armazenada no cofre seguro do Gateway KMS sob criptografia AES-256-GCM.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* P2P Endpoint */}
                {onChainData.endpointUrl && (
                  <div className="p-3 bg-black/50 border border-white/[0.06] rounded-xl space-y-1 text-xs">
                    <div className="flex items-center justify-between text-[10px] text-neutral-400">
                      <span>Endpoint P2P Inbound (Despacho Entre Máquinas):</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(onChainData.endpointUrl, "ep_receipt")}
                        className="hover:text-white transition flex items-center gap-1 cursor-pointer"
                      >
                        {copiedKey === "ep_receipt" ? (
                          <span className="text-emerald-400 font-bold">Copiado!</span>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>
                    <div className="font-mono text-[11px] text-emerald-300 truncate">
                      {onChainData.endpointUrl}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Primary Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-lg mx-auto">
              <Link
                href={`/admin?domain=${encodeURIComponent(domainName)}`}
                className="w-full sm:w-1/2 py-4 px-5 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xl shadow-red-950/50 transition cursor-pointer active:scale-[0.98]"
              >
                <span>Painel Administrador</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href={`/inbox?domain=${encodeURIComponent(domainName)}`}
                className="w-full sm:w-1/2 py-4 px-5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xl shadow-blue-950/50 transition cursor-pointer active:scale-[0.98]"
              >
                <Inbox className="w-4 h-4" />
                <span>Acessar Inbox P2P</span>
              </Link>
            </div>

            {/* Didactic Card: Apontamento DNS do Endpoint P2P (Exibir apenas para instalação soberana) */}
            {isSovereignInstallation && (
              <div className="max-w-2xl mx-auto">
                <div
                  className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                    showP2pDnsCard
                      ? "bg-[#100c14] border-blue-500/40 shadow-xl shadow-blue-950/30"
                      : "bg-white/[0.02] border-white/[0.08] hover:border-white/20"
                  }`}
                >
                  <div
                    onClick={() => setShowP2pDnsCard(!showP2pDnsCard)}
                    className="p-4 sm:p-5 flex items-center justify-between cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-3.5">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition ${
                          showP2pDnsCard
                            ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                            : "bg-white/[0.04] text-neutral-400 border border-white/[0.08]"
                        }`}
                      >
                        <Network className="w-5 h-5" />
                      </div>
                      <div className="text-left">
                        <div className="text-xs sm:text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                          <span>Configuração DNS do Endpoint P2P (Inbound)</span>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/30">
                            Recomendado para Máquinas Autônomas
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-400 mt-0.5">
                          {showP2pDnsCard
                            ? "Permite que outras máquinas e nós da rede MAIVW enviem despachos diretamente para seu servidor"
                            : "Clique para visualizar como apontar o subdomínio mw-p2p no seu provedor DNS"}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 ml-3">
                      {showP2pDnsCard ? (
                        <ChevronUp className="w-5 h-5 text-neutral-300" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-neutral-500" />
                      )}
                    </div>
                  </div>

                  {showP2pDnsCard && (
                    <div className="p-4 sm:p-6 border-t border-white/[0.06] bg-[#08050c] space-y-4 text-left">
                      <p className="text-xs text-neutral-300 leading-relaxed">
                        Se você configurou o endpoint como <span className="font-mono text-blue-300 font-semibold">{onChainData?.endpointUrl || p2pEndpoint || `https://mw-p2p.${domainName}/api/v1/inbox`}</span>, crie o seguinte apontamento no DNS do seu domínio:
                      </p>

                      <div className="p-3.5 bg-black/60 border border-white/[0.08] rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-mono text-[11px] font-bold">
                              CNAME ou A
                            </span>
                            <span className="text-xs font-semibold text-white">Subdomínio Inbound P2P</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                          <div className="sm:col-span-1">
                            <span className="text-[10px] text-neutral-500 block mb-0.5">Host / Subdomínio:</span>
                            <div className="flex items-center justify-between p-2 bg-white/[0.02] border border-white/[0.06] rounded-lg font-mono text-neutral-200 text-[11px]">
                              <span>mw-p2p</span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard("mw-p2p", "p2p_host")}
                                className="p-1 hover:text-white transition cursor-pointer"
                                title="Copiar host"
                              >
                                {copiedKey === "p2p_host" ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                          <div className="sm:col-span-2">
                            <span className="text-[10px] text-neutral-500 block mb-0.5">Destino / Servidor da sua Máquina:</span>
                            <div className="p-2 bg-white/[0.02] border border-blue-500/30 rounded-lg font-mono text-blue-300 text-[11px]">
                              <span>IP público da máquina (registro A) ou CNAME apontando para seu hostname</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl text-[11px] text-neutral-400 leading-relaxed">
                        💡 <b>Comunicação P2P:</b> Ao receber mensagens assinadas de outros nós, seu Gateway local valida a assinatura ECDSA on-chain do remetente e armazena na sua Inbox.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Optional Card: Registros DNS para Roteamento de E-mail */}
            <div className="max-w-2xl mx-auto">
              <div
                className={`rounded-2xl border transition-all duration-200 overflow-hidden ${showEmailDnsCard
                  ? "bg-[#120a0a] border-red-500/40 shadow-xl shadow-red-950/30"
                  : "bg-white/[0.02] border-white/[0.08] hover:border-white/20"
                  }`}
              >
                {/* Header Clickable Toggle */}
                <div
                  onClick={() => setShowEmailDnsCard(!showEmailDnsCard)}
                  className="p-4 sm:p-5 flex items-center justify-between cursor-pointer select-none"
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition ${showEmailDnsCard
                        ? "bg-red-500/20 text-red-400 border border-red-500/30"
                        : "bg-white/[0.04] text-neutral-400 border border-white/[0.08]"
                        }`}
                    >
                      <Mail className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <div className="text-xs sm:text-sm font-bold text-white flex items-center gap-2 flex-wrap">
                        <span>Registros DNS para Roteamento de E-mail</span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/[0.06] text-neutral-400 border border-white/[0.08]">
                          Opcional
                        </span>
                      </div>
                      <div className="text-[11px] text-neutral-400 mt-0.5">
                        {showEmailDnsCard
                          ? "Apontamentos MX e SPF necessários para receber e-mails neste domínio"
                          : "Clique para visualizar e configurar os apontamentos de recebimento (MX e SPF)"}
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 ml-3">
                    {showEmailDnsCard ? (
                      <ChevronUp className="w-5 h-5 text-neutral-300" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-neutral-500" />
                    )}
                  </div>
                </div>

                {/* Expanded Card Content */}
                {showEmailDnsCard && (
                  <div className="p-4 sm:p-6 border-t border-white/[0.06] bg-[#0a0505] space-y-4 text-left">
                    {/* Cloudflare Quick Action */}
                    <div className="p-4 rounded-xl bg-gradient-to-r from-orange-950/30 via-[#180e0a] to-[#120a0a] border border-orange-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400 shrink-0">
                          <Cloud className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white">Configurar via Cloudflare</div>
                          <div className="text-[11px] text-neutral-400">
                            Abre o painel DNS da Cloudflare e copia a entrada automaticamente
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleOpenCloudflareForEmail}
                        className="w-full sm:w-auto px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-black font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition shadow-lg shadow-orange-950/50 cursor-pointer active:scale-95 shrink-0"
                      >
                        <Cloud className="w-3.5 h-3.5" />
                        <span>Abrir na Cloudflare</span>
                        <ExternalLink className="w-3 h-3 opacity-80" />
                      </button>
                    </div>

                    {/* Records List (Mobile Friendly) */}
                    <div className="space-y-3">
                      {/* MX Record */}
                      <div className="p-3.5 bg-black/60 border border-white/[0.08] rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-mono text-[11px] font-bold">
                              MX
                            </span>
                            <span className="text-xs font-semibold text-white">Servidor de E-mail (Inbound)</span>
                          </div>
                          <span className="text-[11px] text-neutral-400 font-mono">Prioridade: 10</span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                          <div className="sm:col-span-1">
                            <span className="text-[10px] text-neutral-500 block mb-0.5">Host / Nome:</span>
                            <div className="p-2 bg-white/[0.02] border border-white/[0.06] rounded-lg font-mono text-neutral-300 text-[11px]">
                              @ ({domainName})
                            </div>
                          </div>
                          <div className="sm:col-span-2">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] text-neutral-500">Valor / Destino:</span>
                              {copiedKey === "cf_email_auto" && (
                                <span className="text-[10px] text-emerald-400 font-bold animate-pulse">Copiado!</span>
                              )}
                            </div>
                            <div className="flex items-center justify-between p-2 bg-white/[0.02] border border-blue-500/30 rounded-lg font-mono text-blue-300 text-[11px]">
                              <span className="truncate">{records?.mx?.value || "inbound.maivw.com"}</span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(records?.mx?.value || "inbound.maivw.com", "mx_val")}
                                className="p-1 hover:text-white transition cursor-pointer shrink-0 ml-2"
                                title="Copiar MX"
                              >
                                {copiedKey === "mx_val" ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* SPF Record */}
                      <div className="p-3.5 bg-black/60 border border-white/[0.08] rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono text-[11px] font-bold">
                              TXT
                            </span>
                            <span className="text-xs font-semibold text-white">Autorização de Envio (SPF)</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                          <div className="sm:col-span-1">
                            <span className="text-[10px] text-neutral-500 block mb-0.5">Host / Nome:</span>
                            <div className="p-2 bg-white/[0.02] border border-white/[0.06] rounded-lg font-mono text-neutral-300 text-[11px]">
                              @ ({domainName})
                            </div>
                          </div>
                          <div className="sm:col-span-2">
                            <span className="text-[10px] text-neutral-500 block mb-0.5">Valor / Conteúdo TXT:</span>
                            <div className="flex items-center justify-between p-2 bg-white/[0.02] border border-amber-500/30 rounded-lg font-mono text-amber-300 text-[11px]">
                              <span className="truncate">{records?.spf?.value || "v=spf1 include:_spf.maivw.com ~all"}</span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(records?.spf?.value || "v=spf1 include:_spf.maivw.com ~all", "spf_val")}
                                className="p-1 hover:text-white transition cursor-pointer shrink-0 ml-2"
                                title="Copiar SPF"
                              >
                                {copiedKey === "spf_val" ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl text-[11px] text-neutral-400 leading-relaxed">
                      💡 <b>Dica:</b> Você pode configurar estes registros agora ou mais tarde diretamente no seu painel de controle. Suas caixas postais corporativas e chaves de API podem ser gerenciadas a qualquer momento no Painel do Administrador.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Link to Admin */}
            <div className="pt-4 border-t border-white/[0.06] text-center">
              <Link
                href={`/admin?domain=${encodeURIComponent(domainName)}`}
                className="text-xs text-neutral-400 hover:text-white transition inline-flex items-center gap-1.5"
              >
                <span>Configurar caixas postais e chaves de API no painel</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        )}

        {/* ========================================================== */}
        {/* MODAL: ASSISTENTE CLOUDFLARE (PROVA DE POSSE TXT)        */}
        {/* ========================================================== */}
        {showCloudflareAssistant && records && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="bg-[#120a0a] border border-orange-500/40 rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
              <button
                type="button"
                onClick={() => setShowCloudflareAssistant(false)}
                className="absolute top-4 right-4 p-2 text-neutral-400 hover:text-white rounded-full bg-white/[0.04] hover:bg-white/[0.1] transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Assistente Cloudflare — Prova de Posse</h3>
                  <p className="text-xs text-neutral-400">Siga o passo a passo na aba aberta da Cloudflare</p>
                </div>
              </div>

              <div className="space-y-3 text-xs text-neutral-300">
                <div className="flex items-start gap-3 p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl">
                  <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 font-bold flex items-center justify-center shrink-0 text-[11px]">1</span>
                  <p>Na aba da Cloudflare, selecione o domínio <b className="text-white">{domainName}</b> e vá em <b className="text-white">DNS &rarr; Records</b>.</p>
                </div>

                <div className="flex items-start gap-3 p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl">
                  <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 font-bold flex items-center justify-center shrink-0 text-[11px]">2</span>
                  <p>Clique em <b className="text-white">"Add record"</b> e preencha os 3 campos abaixo:</p>
                </div>

                {/* Pre-filled helpers */}
                <div className="p-3.5 bg-[#0a0505] border border-orange-500/30 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400 text-[11px]">Type:</span>
                    <span className="font-mono text-orange-300 font-bold bg-orange-500/10 px-2 py-0.5 rounded">TXT</span>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400 text-[11px]">Name:</span>
                    <div className="flex items-center gap-1.5 font-mono text-white text-[11px]">
                      <span>{records.txt.name}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(records.txt.name, "cf_m_name")}
                        className="p-1 hover:text-orange-400 transition cursor-pointer"
                        title="Copiar Nome"
                      >
                        {copiedKey === "cf_m_name" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400 text-[11px]">Content:</span>
                    <div className="flex items-center gap-1.5 font-mono text-red-300 text-[11px]">
                      <span className="truncate max-w-[200px]">{records.txt.value}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(records.txt.value, "cf_m_val")}
                        className="p-1 hover:text-orange-400 transition cursor-pointer"
                        title="Copiar Valor"
                      >
                        {copiedKey === "cf_m_val" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-neutral-400 text-[11px]">TTL:</span>
                    <span className="font-mono text-neutral-300 text-[11px]">Auto</span>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-white/[0.02] border border-white/[0.06] rounded-xl">
                  <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-400 font-bold flex items-center justify-center shrink-0 text-[11px]">3</span>
                  <p>Clique em <b className="text-white">Save</b> na Cloudflare. O registro propaga em segundos!</p>
                </div>
              </div>

              {/* Modal footer actions */}
              <div className="mt-6 flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    handleCheckDns();
                    setShowCloudflareAssistant(false);
                  }}
                  className="w-full sm:flex-1 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-950/50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Já salvei na Cloudflare, verificar agora!</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowCloudflareAssistant(false)}
                  className="w-full sm:w-auto px-4 py-2.5 bg-white/[0.04] hover:bg-white/[0.08] text-neutral-400 hover:text-white rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================== */}
        {/* MODAL: ASSISTENTE CLOUDFLARE (E-MAILS MX & SPF)           */}
        {/* ========================================================== */}
        {showCloudflareEmailAssistant && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <div className="bg-[#120a0a] border border-orange-500/40 rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
              <button
                type="button"
                onClick={() => setShowCloudflareEmailAssistant(false)}
                className="absolute top-4 right-4 p-2 text-neutral-400 hover:text-white rounded-full bg-white/[0.04] hover:bg-white/[0.1] transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-orange-400">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Assistente Cloudflare — Registros de E-mail</h3>
                  <p className="text-xs text-neutral-400">Adicione as entradas MX e SPF na sua zona Cloudflare</p>
                </div>
              </div>

              <div className="space-y-3.5 text-xs text-neutral-300">
                <div className="p-3 bg-[#0a0505] border border-orange-500/30 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold text-blue-300">
                    <span>1. Registro MX (Recebimento):</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-neutral-400">Type: MX | Priority: 10</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] bg-black/60 p-2 rounded-lg font-mono">
                    <span className="text-neutral-300 truncate">{records?.mx?.value || "inbound.maivw.com"}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(records?.mx?.value || "inbound.maivw.com", "cf_em_mx")}
                      className="p-1 hover:text-blue-400 transition cursor-pointer"
                    >
                      {copiedKey === "cf_em_mx" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="p-3 bg-[#0a0505] border border-orange-500/30 rounded-xl space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold text-amber-300">
                    <span>2. Registro TXT (SPF):</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-neutral-400">Type: TXT | Name: @</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] bg-black/60 p-2 rounded-lg font-mono">
                    <span className="text-neutral-300 truncate">{records?.spf?.value || "v=spf1 include:_spf.maivw.com ~all"}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(records?.spf?.value || "v=spf1 include:_spf.maivw.com ~all", "cf_em_spf")}
                      className="p-1 hover:text-amber-400 transition cursor-pointer"
                    >
                      {copiedKey === "cf_em_spf" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowCloudflareEmailAssistant(false)}
                  className="px-5 py-2.5 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white font-bold rounded-xl text-xs cursor-pointer shadow-lg"
                >
                  Entendi, Concluir
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-5 text-center text-xs text-neutral-500">
        <p>
          Protocolo MAIVW — Domínio Central:{" "}
          <span className="font-mono text-neutral-400">maivw.com</span>
        </p>
      </footer>
    </div>
  );
}
