// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://docs.maivw.org',
	integrations: [
		starlight({
			title: 'Protocol',
			description: 'Documentação Oficial do MAIVW — Protocolo P2P de E-mail Soberano e Descentralizado',
			logo: {
				light: './src/assets/brand/wordmark-red.png',
				dark: './src/assets/brand/wordmark-white-transparent.png',
				alt: 'MAIVW',
				replacesTitle: false,
			},
			favicon: '/brand/monogram-badge.png',
			customCss: [
				'./src/styles/custom.css',
			],
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/SilvioSLN/maivw-protocol' }
			],
			sidebar: [
				{
					label: 'Início',
					items: [
						{ label: 'Introdução & Visão Geral', slug: 'index' },
						{ label: 'Guia Rápido (Quickstart)', slug: 'quickstart' },
					],
				},
				{
					label: '1. Usuários & Operadores',
					items: [
						{ label: 'Início Rápido com Docker', slug: 'users/quickstart-docker' },
						{ label: 'Configuração de Domínio & DNS', slug: 'users/dns-domain-setup' },
						{ label: 'Guia do Webmail Soberano', slug: 'users/webmail-guide' },
						{ label: 'Diagnóstico & Troubleshooting', slug: 'users/troubleshooting' },
						{ label: 'Deploy com Docker Compose', slug: 'self-hosting/docker' },
						{ label: 'Variáveis de Ambiente', slug: 'self-hosting/env-vars' },
					],
				},
				{
					label: '2. Desenvolvedores & Arquitetura',
					items: [
						{ label: 'Especificação da Arquitetura', slug: 'developers/architecture-spec' },
						{ label: 'Matriz de Segurança', slug: 'developers/security-matrix' },
						{ label: 'Especificação do Handshake P2P', slug: 'developers/p2p-handshake-spec' },
						{ label: 'Oráculos & Arbitragem On-Chain', slug: 'developers/oracle-arbitration' },
						{ label: 'Economia de Gas & Staking', slug: 'developers/gas-economics' },
						{ label: 'Gateway REST API', slug: 'api/gateway' },
						{ label: 'Cartório On-Chain & Contratos', slug: 'contracts/registry' },
						{ label: 'Filosofia & Arquitetura Geral', slug: 'architecture/overview' },
						{ label: 'Handshake & Roteamento P2P', slug: 'architecture/p2p-handshake' },
					],
				},
				{
					label: '3. Contribuidores & Open Source',
					items: [
						{ label: 'Setup do Ambiente Local', slug: 'contributors/local-setup' },
						{ label: 'Visão Geral da Base de Código', slug: 'contributors/codebase-overview' },
						{ label: 'Testes & Depuração', slug: 'contributors/testing-and-debugging' },
						{ label: 'Diretrizes de Contribuição', slug: 'contributors/contributing-guidelines' },
					],
				},
				{
					label: '4. Tutoriais Práticos',
					items: [
						{ label: 'Setup do Nó Passo a Passo', slug: 'tutorials/node-setup' },
						{ label: 'Apontamento DNS Completo', slug: 'tutorials/dns-configuration' },
						{ label: 'Enviando Primeiro E-mail', slug: 'tutorials/sending-first-email' },
						{ label: 'Migração Corporativa & Coexistência', slug: 'tutorials/enterprise-migration' },
					],
				},
			],
		}),
	],
});
