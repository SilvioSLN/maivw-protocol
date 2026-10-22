"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavigationProps {
  contractAddress?: string;
}

export function Navigation({ contractAddress }: NavigationProps) {
  const pathname = usePathname();

  const navItems = [
    { href: "/", label: "Visão Geral & Nó", icon: "📊" },
    { href: "/cartorio", label: "Cartório & Domínios", icon: "🏛️" },
  ];

  return (
    <header className="header" style={{ marginBottom: "2rem" }}>
      <div className="logo" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <div
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "12px",
            background: "linear-gradient(135deg, #7d0000 0%, #300000 100%)",
            border: "1px solid rgba(255,255,255,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.4rem",
            boxShadow: "0 0 20px rgba(125,0,0,0.5)",
          }}
        >
          🛡️
        </div>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.25rem", fontWeight: 800, letterSpacing: "-0.02em", color: "#f5eded" }}>
              MAIVW
            </span>
            <span
              style={{
                fontSize: "0.65rem",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                background: "rgba(125, 0, 0, 0.4)",
                color: "#ff6b6b",
                padding: "0.15rem 0.5rem",
                borderRadius: "999px",
                border: "1px solid rgba(255, 107, 107, 0.3)",
                fontWeight: 700,
              }}
            >
              Explorer &amp; Nó
            </span>
          </div>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "2px" }}>
            Status do Nó Local &amp; Cartório Público de Identidades
          </p>
        </div>
      </div>

      <nav
        className="tabs-nav"
        style={{
          margin: 0,
          background: "var(--bg-secondary)",
          border: "1px solid var(--border)",
          padding: "0.35rem",
          borderRadius: "14px",
          display: "flex",
          gap: "0.35rem",
          flexWrap: "wrap",
        }}
      >
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`tab-btn ${isActive ? "active" : ""}`}
              style={{
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.5rem 1rem",
                borderRadius: "10px",
                fontSize: "0.85rem",
                fontWeight: isActive ? 700 : 500,
                color: isActive ? "#ffffff" : "var(--text-secondary)",
                background: isActive ? "var(--accent-primary)" : "transparent",
                transition: "all 0.2s ease",
              }}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <a
          href={`${(process.env.NEXT_PUBLIC_WEBMAIVW_URL || "http://localhost:52443").replace(/\/+$/, "")}/admin`}
          target="_blank"
          rel="noreferrer"
          style={{
            textDecoration: "none",
            fontSize: "0.75rem",
            fontWeight: 600,
            padding: "0.5rem 0.85rem",
            borderRadius: "10px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "var(--text-secondary)",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            transition: "all 0.2s",
          }}
        >
          <span>WebMaivw Admin</span>
          <span>↗</span>
        </a>
      </div>
    </header>
  );
}
