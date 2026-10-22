// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://docs.maivw.com',
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
			head: [
				{
					tag: 'script',
					attrs: {
						async: true,
						src: 'https://www.googletagmanager.com/gtag/js?id=G-2G2NC9JP9W',
					},
				},
				{
					tag: 'script',
					content: `
						window.dataLayer = window.dataLayer || [];
						function gtag(){dataLayer.push(arguments);}
						gtag('js', new Date());
						gtag('config', 'G-2G2NC9JP9W');
					`,
				},
			],
			sidebar: [
				{ label: 'Início', items: [
					{ label: 'Introdução', slug: 'index' },
					{ label: 'Começar', slug: 'quickstart' },
					{ label: 'Estado dos recursos', slug: 'status' },
				] },
				{ label: 'Usuários e operação', items: [
					{ label: 'Instalação com Docker', slug: 'users/quickstart-docker' },
					{ label: 'Domínio e DNS', slug: 'users/dns-domain-setup' },
					{ label: 'Webmail', slug: 'users/webmail-guide' },
					{ label: 'Serviços e persistência', slug: 'self-hosting/docker' },
					{ label: 'Papéis de runtime', slug: 'self-hosting/runtime-roles' },
					{ label: 'Variáveis de ambiente', slug: 'self-hosting/env-vars' },
					{ label: 'Operação e backup', slug: 'self-hosting/operations' },
					{ label: 'Diagnóstico', slug: 'users/troubleshooting' },
				] },
				{ label: 'Arquitetura e protocolo', items: [
					{ label: 'Visão geral', slug: 'architecture/overview' },
					{ label: 'Planejador de implantação', slug: 'architecture/deployment-planner' },
					{ label: 'Origem e espelhamento multichain', slug: 'architecture/multichain-origin-and-mirroring' },
					{ label: 'Economia do Registry Solana', slug: 'architecture/solana-economics' },
					{ label: 'Catálogo de origem e concorrência', slug: 'architecture/origin-catalog-and-concurrency' },
					{ label: 'Chaves e autoridades', slug: 'architecture/key-authority-policy' },
					{ label: 'Fluxos do Gateway', slug: 'developers/architecture-spec' },
					{ label: 'Garantias e limites', slug: 'developers/security-matrix' },
					{ label: 'Especificação P2P', slug: 'developers/p2p-handshake-spec' },
					{ label: 'Oráculo e disputas', slug: 'developers/oracle-arbitration' },
					{ label: 'Gas e custos', slug: 'developers/gas-economics' },
					{ label: 'Contratos e deploy', slug: 'contracts/registry' },
				] },
				{ label: 'API e integração', items: [
					{ label: 'Mensagens e anexos', slug: 'api/gateway' },
					{ label: 'Contas e onboarding', slug: 'api/accounts' },
					{ label: 'SMTP e administração', slug: 'api/operations' },
					{ label: 'Inventário de rotas', slug: 'api/routes' },
					{ label: 'Primeiro envio', slug: 'tutorials/sending-first-email' },
					{ label: 'Piloto e coexistência', slug: 'tutorials/enterprise-migration' },
				] },
				{ label: 'Contribuição', items: [
					{ label: 'Ambiente local', slug: 'contributors/local-setup' },
					{ label: 'Mapa do código', slug: 'contributors/codebase-overview' },
					{ label: 'Testes', slug: 'contributors/testing-and-debugging' },
					{ label: 'Diretrizes', slug: 'contributors/contributing-guidelines' },
				] },
			],
		}),
	],
});
