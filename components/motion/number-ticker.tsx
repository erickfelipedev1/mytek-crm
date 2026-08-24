"use client";

import { useEffect, useRef } from "react";
import { useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";

import { cn } from "@/lib/utils";

interface NumberTickerProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: number;
  startValue?: number;
  /** Segundos de espera após entrar na viewport. */
  delay?: number;
  decimalPlaces?: number;
  prefix?: string;
  suffix?: string;
}

/**
 * Número que sobe contando quando entra na tela. Portado do mytek-site
 * ("velora") pra dar o mesmo acabamento aos números do CRM.
 *
 * Sob prefers-reduced-motion, pula direto pro valor final — a contagem em si
 * é decorativa, o número não pode depender de animação para ser lido.
 */
export function NumberTicker({
  value,
  startValue = 0,
  delay = 0,
  decimalPlaces = 0,
  prefix = "",
  suffix = "",
  className,
  ...props
}: NumberTickerProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reducedMotion = useReducedMotion();
  const motionValue = useMotionValue(startValue);
  const springValue = useSpring(motionValue, { damping: 60, stiffness: 100 });
  const isInView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });

  const format = (n: number) =>
    `${prefix}${Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    }).format(n)}${suffix}`;

  useEffect(() => {
    if (!isInView) return;
    if (reducedMotion) {
      motionValue.jump(value);
      return;
    }
    const timeout = setTimeout(() => motionValue.set(value), delay * 1000);
    return () => clearTimeout(timeout);
  }, [isInView, motionValue, value, delay, reducedMotion]);

  useEffect(
    () =>
      springValue.on("change", (latest) => {
        if (ref.current) ref.current.textContent = format(latest);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [springValue, prefix, suffix, decimalPlaces],
  );

  return (
    <span
      ref={ref}
      data-slot="number-ticker"
      className={cn("inline-block tabular-nums", className)}
      {...props}
    >
      {format(startValue)}
    </span>
  );
}
