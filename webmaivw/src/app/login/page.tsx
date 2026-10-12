"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Mail, ArrowRight, Lock, AlertCircle, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const { login, loginWithGoogle, isLoading: authLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFormValid = email.includes("@") && password.length >= 6;

  const handleGoogleLogin = async () => {
    setIsGoogleLoading(true);
    setError(null);
    const result = await loginWithGoogle();
    if (result.ok) {
      if (result.isNewUser) {
        router.push("/onboarding");
      } else {
        router.push("/inbox");
      }
    } else {
      setError(result.error || "Erro ao conectar com Google");
      setIsGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const result = await login(email.trim(), password);

    if (result.ok) {
      router.push("/inbox");
    } else {
      setError(result.error || "Erro ao fazer login");
    }

    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="p-2.5 rounded-2xl bg-[#7d0000] border border-[#7d0000]/60 shadow-xl shadow-[#7d0000]/25 inline-flex items-center justify-center">
              <img
                src="/logo-maivw.png"
                alt="MAIVW"
                className="h-10 w-auto object-contain rounded-md"
              />
            </div>
          </div>
          <h1 className="text-2xl font-black text-white tracking-wide">WebMaivw</h1>
          <p className="text-sm text-red-200/70 mt-1">Acesso ao e-mail criptográfico e SMTP unificado</p>
        </div>

        {/* Form Card */}
        <div className="bg-slate-900/80 border border-[#7d0000]/30 rounded-3xl p-8 shadow-2xl backdrop-blur-xl">
          {/* Google Login Button */}
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={isGoogleLoading}
            className="w-full mb-5 py-2.5 px-4 bg-[#141419] hover:bg-[#1c1c24] border border-white/[0.08] hover:border-white/[0.16] rounded-xl text-xs font-medium text-slate-200 flex items-center justify-center gap-2.5 transition active:scale-[0.98] cursor-pointer"
          >
            {isGoogleLoading ? (
              <div className="w-3.5 h-3.5 border-2 border-slate-400 border-t-white rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/>
                <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/>
                <path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z"/>
                <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16c1.8 3.7 5.6 7 10.1 7z"/>
              </svg>
            )}
            <span>Entrar com o Google</span>
          </button>

          <div className="relative mb-5 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-800" />
            </div>
            <span className="relative bg-slate-900 px-3 text-[11px] text-slate-500 font-medium">ou e-mail e senha</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contato@suaempresa.com"
                required
                autoFocus
                className="w-full px-4 py-3 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7d0000] transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">Senha</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Sua senha"
                  required
                  className="w-full px-4 py-3 pr-12 bg-slate-950/80 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[#7d0000] transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-500 hover:text-slate-300 transition"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className={`w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition ${
                isFormValid && !isSubmitting
                  ? "bg-[#7d0000] hover:bg-[#990000] text-white shadow-lg shadow-[#7d0000]/30 cursor-pointer active:scale-95"
                  : "bg-slate-800 text-slate-500 cursor-not-allowed"
              }`}
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Entrando...</span>
                </>
              ) : (
                <>
                  <span>Entrar</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-800/80 text-center">
            <p className="text-xs text-slate-400">
              Não tem uma conta?{" "}
              <a
                href="/signup"
                className="text-red-400 hover:text-red-300 font-medium transition"
              >
                Cadastre-se no Maivw
              </a>
            </p>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-500 flex items-center justify-center gap-1.5">
          <Lock className="w-3.5 h-3.5 text-red-400" />
          Conexão protegida pelo Protocolo MAIVW
        </p>
      </div>
    </div>
  );
}
