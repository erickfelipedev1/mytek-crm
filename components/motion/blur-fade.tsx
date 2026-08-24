"use client";

import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";

interface BlurFadeProps {
  children: React.ReactNode;
  className?: string;
  /** Segundos antes de a animação começar. */
  delay?: number;
  duration?: number;
  /** Direção de onde o elemento entra. */
  direction?: "up" | "down" | "left" | "right" | "none";
  /** Distância percorrida, em px. */
  offset?: number;
  /** Anima só na primeira vez que entra na viewport. */
  once?: boolean;
}

const axis = { up: "y", down: "y", left: "x", right: "x" } as const;
const sign = { up: 1, down: -1, left: 1, right: -1 } as const;

/**
 * Entrada suave (blur + fade + leve deslocamento) para telas e cards.
 * Portado do mytek-site (componente "velora") para o mesmo visual da marca.
 */
export function BlurFade({
  children,
  className,
  delay = 0,
  duration = 0.5,
  direction = "up",
  offset = 12,
  once = true,
}: BlurFadeProps) {
  const reducedMotion = useReducedMotion();

  const hidden =
    direction === "none"
      ? { opacity: 0, filter: "blur(4px)" }
      : {
          opacity: 0,
          filter: "blur(4px)",
          [axis[direction]]: sign[direction] * offset,
        };

  return (
    <motion.div
      data-slot="blur-fade"
      className={cn(className)}
      initial={hidden}
      whileInView={{ opacity: 1, filter: "blur(0px)", x: 0, y: 0 }}
      viewport={{ once, margin: "0px 0px -10% 0px" }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : { delay, duration, ease: [0.21, 0.47, 0.32, 0.98] }
      }
    >
      {children}
    </motion.div>
  );
}
