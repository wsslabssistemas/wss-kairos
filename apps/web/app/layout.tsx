import type { Metadata, Viewport } from "next";
import { Archivo, Sora } from "next/font/google";
import { BRAND_NAME, MAKER } from "@/lib/brand";
import PwaRegister from "./pwa-register";
import "./globals.css";

/**
 * ⚠ SAIU O INTER, E O MOTIVO NÃO É GOSTO.
 *
 * Inter é a fonte padrão de praticamente todo painel SaaS — é a escolha que
 * qualquer template já vem fazendo, e por isso ela não diz nada sobre quem
 * somos. O sistema de design do concorrente lista "Inter como font family"
 * como anti-padrão número 1, e os guias de 2026 a citam como o default
 * genérico. Ficar nela é aceitar parecer template.
 *
 * ARCHIVO faz o trabalho: grotesca sólida, largura estreita o suficiente para
 * tela densa, legível a 13px — que é o tamanho onde a recepcionista de fato lê.
 *
 * SORA aparece pouco e de propósito: título de página e marca. Ela é
 * geométrica e tem ar técnico, que conversa com o logo da WSS Labs (um buraco
 * negro com disco de acreção) sem precisar de efeito nenhum. Usada em texto
 * corrido ela cansaria; usada em três lugares, dá personalidade.
 */
const archivo = Archivo({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const sora = Sora({
  subsets: ["latin"],
  display: "swap",
  weight: ["600", "700"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  applicationName: BRAND_NAME,
  title: {
    default: `${BRAND_NAME} — inteligência comercial`,
    template: `%s · ${BRAND_NAME}`,
  },
  description: `Inteligência comercial multi-tenant. ${MAKER}.`,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: BRAND_NAME,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#080b14",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${archivo.variable} ${sora.variable}`}>
      <head>
        {/*
          ⚠ O TEMA É APLICADO ANTES DE PINTAR, e é por isso que ele é um script
          cru no `<head>` em vez de um `useEffect`.

          Com `useEffect` a página pinta primeiro no tema padrão e corrige
          depois: quem escolheu claro vê um flash escuro em CADA navegação. Não
          é detalhe estético — é o tipo de tremida que faz o produto parecer
          malfeito, e aparece justamente para quem se deu ao trabalho de
          escolher.

          ⚠ E ELE FALHA CALADO DE PROPÓSITO. Em janela anônima, com cookies
          bloqueados ou na captura de miniatura, `localStorage` lança. Tema é
          conforto; conforto que derruba a tela é pior que tela sem conforto —
          então o `catch` vazio aqui é decisão, não descuido.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('kairos-tema');" +
              "if(t==='claro')document.documentElement.setAttribute('data-theme','light');" +
              "else if(t==='escuro')document.documentElement.setAttribute('data-theme','dark');}catch(e){}",
          }}
        />
      </head>
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
