import { Barlow_Condensed, JetBrains_Mono } from "next/font/google";
// System type carries the interface. The condensed face is spent on one thing (amounts and the seal); mono on identifiers.
export const display = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-display", display: "swap" });
export const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-mono", display: "swap" });
