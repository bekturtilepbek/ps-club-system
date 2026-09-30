import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      screens: {
        // a 1366×768 till monitor: both rows of consoles must fit without scrolling
        short: { raw: "(max-height: 820px) and (min-width: 1101px)" },
      },
      fontFamily: {
        sans: ['"Golos Text"', "system-ui", "sans-serif"],
        display: ["Unbounded", '"Golos Text"', "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        bg: token("bg"),
        surface: { DEFAULT: token("surface"), 2: token("surface-2") },
        line: token("line"),
        fg: { DEFAULT: token("fg"), muted: token("fg-muted"), faint: token("fg-faint") },
        ink: token("ink"),
        hover: { DEFAULT: token("hover"), line: token("hover-line") },
        rail: token("rail"),
        status: {
          cross: token("cross"),
          triangle: token("triangle"),
          circle: token("circle"),
          square: token("square"),
          amber: token("amber"),
          "amber-text": token("amber-text"),
          idle: token("idle"),
        },
        tone: "hsl(var(--c) / <alpha-value>)",
        // shadcn/ui names
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
        breathe: { "50%": { opacity: "0.35" } },
        flow: { to: { backgroundPosition: "16px 0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        breathe: "breathe 2.4s ease-in-out infinite",
        "breathe-fast": "breathe 1s ease-in-out infinite",
        flow: "flow 1.2s linear infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
