import { Barlow_Condensed, Source_Serif_4, JetBrains_Mono } from "next/font/google";
// Free stand-ins for the editorial pairing (compressed extrabold display + serif body).
export const display = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display", display: "swap" });
export const serif = Source_Serif_4({ subsets: ["latin"], weight: ["400", "500", "600"], style: ["normal", "italic"], variable: "--font-serif", display: "swap" });
export const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-mono", display: "swap" });
