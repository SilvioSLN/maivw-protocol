"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, AlertCircle, RefreshCw, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getFirebaseRuntimeConfig } from "@/lib/firebase";

export default function SignupPage() {
  const router = useRouter();
  const { register, loginWithGoogle, loginWithGithub } = useAuth();

  const [registrationToken, setRegistrationToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSocialSubmitting, setIsSocialSubmitting] = useState<"google" | "github" | null>(null);
  const [activeProviders, setActiveProviders] = useState<string[]>(["google.com"]);
  const [socialEnabled, setSocialEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let isMounted = true;
    getFirebaseRuntimeConfig()
      .then((cfg) => {
        if (!isMounted) return;
        if (!cfg.enabled) {
          setSocialEnabled(false);
          setActiveProviders([]);
        } else {
          setSocialEnabled(true);
          setActiveProviders(Array.isArray(cfg.providers) ? cfg.providers : ["google.com"]);
        }
      })
      .catch(() => {
        // Keep safe defaults
      });
    return () => {
      isMounted = false;
    };
  }, []);


  const isFormValid = email.includes("@") && password.length >= 12 && password.length <= 128;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    const result = await register(email.trim(), password, undefined, registrationToken || undefined);

    if (result.ok) {
      setSuccess(true);
      setTimeout(() => {
        router.push("/onboarding");
      }, 500);
    } else {
      setError(result.error || "Erro ao criar conta.");
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignup = async () => {
    if (isSocialSubmitting) return;
    setIsSocialSubmitting("google");
    setError(null);

    const result = await loginWithGoogle(registrationToken || undefined);

    if (result.ok) {
      if (result.isNewUser) {
        router.push("/onboarding");
      } else {
        router.push("/inbox");
      }
    } else {
      setError(result.error || "Não foi possível conectar com o Google.");
      setIsSocialSubmitting(null);
    }
  };

  const handleGithubSignup = async () => {
    if (isSocialSubmitting) return;
    setIsSocialSubmitting("github");
    setError(null);

    const result = await loginWithGithub(registrationToken || undefined);

    if (result.ok) {
      if (result.isNewUser) {
        router.push("/onboarding");
      } else {
        router.push("/inbox");
      }
    } else {
      setError(result.error || "Não foi possível conectar com o GitHub.");
      setIsSocialSubmitting(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#070101] text-slate-100 flex flex-col justify-between relative overflow-hidden selection:bg-[#7d0000] selection:text-white">
      {/* Ambient background light matching Resend & Maivw dark luxury aesthetic */}
      <div className="absolute -top-32 -right-32 w-96 h-96 bg-[#7d0000]/15 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-[#3a0000]/20 rounded-full blur-[140px] pointer-events-none" />

      {/* Main card container */}
      <div className="flex-1 flex items-center justify-center px-4 py-12 relative z-10">
        <div className="w-full max-w-[390px] mx-auto">
          {/* Logo badge */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#7d0000] via-[#550000] to-[#250000] p-[1.5px] shadow-xl shadow-red-950/60 inline-flex items-center justify-center transition-transform hover:scale-105 shrink-0">
              <div className="w-full h-full bg-[#0c0505] rounded-[14px] flex items-center justify-center p-2">
                <img
                  src="/logo-mw-badge.png"
                  alt="Maivw Logo"
                  className="w-full h-full object-contain rounded-md"
                />
              </div>
            </div>
          </div>

          {/* Heading */}
          <div className="text-center mb-7">
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Create a Maivw account
            </h1>
            <p className="text-xs text-neutral-400 mt-2">
              Already have an account?{" "}
              <Link
                href="/login"
                className="text-white hover:text-red-300 font-medium transition underline underline-offset-2"
              >
                Log in
              </Link>
              .
            </p>
          </div>

          {/* Social Auth Buttons */}
          {socialEnabled && activeProviders.length > 0 && (
            <>
              <div className={activeProviders.includes("github.com") ? "grid grid-cols-2 gap-3 mb-6" : "mb-6"}>
                {/* Google Button */}
                {activeProviders.includes("google.com") && (
                  <button
                    type="button"
                    onClick={handleGoogleSignup}
                    disabled={isSocialSubmitting !== null}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-[#131215] hover:bg-[#1a191f] border border-white/[0.08] hover:border-white/[0.16] rounded-xl text-xs font-medium text-neutral-200 transition active:scale-[0.98] cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    {isSocialSubmitting === "google" ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-neutral-300" />
                    ) : (
                      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24">
                        <path
                          fill="#EA4335"
                          d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15s.7 5.3 1.9 7.7l3.7-2.9z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16c1.8 3.7 5.6 7 10.1 7z"
                        />
                      </svg>
                    )}
                    <span className="truncate">Log in with Google</span>
                  </button>
                )}

                {/* GitHub Button - only if enabled/configured */}
                {activeProviders.includes("github.com") && (
                  <button
                    type="button"
                    onClick={handleGithubSignup}
                    disabled={isSocialSubmitting !== null}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-[#131215] hover:bg-[#1a191f] border border-white/[0.08] hover:border-white/[0.16] rounded-xl text-xs font-medium text-neutral-200 transition active:scale-[0.98] cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    {isSocialSubmitting === "github" ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-neutral-300" />
                    ) : (
                      <svg className="w-3.5 h-3.5 shrink-0 fill-current text-neutral-200" viewBox="0 0 24 24">
                        <path
                          fillRule="evenodd"
                          clipRule="evenodd"
                          d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                        />
                      </svg>
                    )}
                    <span className="truncate">Log in with GitHub</span>
                  </button>
                )}
              </div>

              {/* Divider */}
              <div className="relative my-6 flex items-center justify-center">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/[0.08]" />
                </div>
                <span className="relative bg-[#070101] px-3 text-xs text-neutral-500 font-medium">
                  or
                </span>
              </div>
            </>
          )}


          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email Field */}
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alan.turing@example.com"
                required
                autoComplete="email"
                className="w-full px-3.5 py-2.5 bg-[#121115] border border-white/[0.09] rounded-xl text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-[#7d0000] focus:ring-1 focus:ring-[#7d0000] transition"
              />
            </div>

            <div>
              <label htmlFor="registration-token" className="block text-xs font-medium text-neutral-300 mb-1.5">Código de convite (se exigido pelo operador)</label>
              <input id="registration-token" type="password" value={registrationToken}
                onChange={(event) => setRegistrationToken(event.target.value)} autoComplete="off"
                className="w-full px-3.5 py-2.5 bg-[#121115] border border-white/[0.09] rounded-xl text-sm"
                placeholder="Opcional em instalações com cadastro público" />
              <p className="mt-1 text-xs text-neutral-400">Use o código fornecido pelo operador quando esta instalação restringir novos administradores.</p>
            </div>


            {/* Password Field */}
            <div>
              <label className="block text-xs font-medium text-neutral-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  className="w-full px-3.5 py-2.5 pr-10 bg-[#121115] border border-white/[0.09] rounded-xl text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-[#7d0000] focus:ring-1 focus:ring-[#7d0000] transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-neutral-500 hover:text-neutral-300 transition cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Feedback Alert */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/25 rounded-xl text-xs text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Conta criada! Iniciando configuração do domínio...</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!isFormValid || isSubmitting || success}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition cursor-pointer ${isFormValid && !isSubmitting && !success
                ? "bg-gradient-to-r from-[#7d0000] to-[#990000] hover:from-[#900000] hover:to-[#b30000] text-white shadow-lg shadow-red-950/50 active:scale-[0.98]"
                : "bg-white/[0.04] text-neutral-500 border border-white/[0.06] cursor-not-allowed"
                }`}
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Creating account...</span>
                </>
              ) : (
                <span>Create account</span>
              )}
            </button>
          </form>

          {/* Legal disclaimer footer */}
          <p className="mt-8 text-center text-[11px] leading-relaxed text-neutral-500">
            By signing up, you agree to our{" "}
            <a href="#" className="underline underline-offset-2 hover:text-neutral-300 transition">
              Terms
            </a>
            ,{" "}
            <a href="#" className="underline underline-offset-2 hover:text-neutral-300 transition">
              Acceptable Use
            </a>
            , and{" "}
            <a href="#" className="underline underline-offset-2 hover:text-neutral-300 transition">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
