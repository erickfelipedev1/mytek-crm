"use client";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAttendantMetrics, type AttendantMetric } from "@/hooks/metrics/useAttendantMetrics";
import { AtritoPanel } from "./AtritoPanel";
import { useTeamMembers } from "@/hooks/team/useTeamMembers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BlurFade } from "@/components/motion/blur-fade";
import { NumberTicker } from "@/components/motion/number-ticker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "__all__";

// Mesma convenção de `--primary`/`--border`/`--popover` do resto do design system:
// tokens já resolvem para hex, então NUNCA envolver em hsl(...) aqui.
const tooltipStyle = {
  borderRadius: "8px",
  fontSize: "12px",
  border: "1px solid var(--border)",
  background: "var(--popover)",
};

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m}min` : `${m}min ${rest}s`;
}

function attendantLabel(a: AttendantMetric): string {
  return a.name ?? a.email ?? `Atendente ${a.user_id.slice(0, 8)}`;
}

/** Cartão de indicador — o resumo que dá pra ler em 1 segundo, sem abrir nada. */
function KpiCard({
  label,
  value,
  decimalPlaces = 0,
  suffix = "",
  accent,
}: {
  label: string;
  value: number;
  decimalPlaces?: number;
  suffix?: string;
  accent?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className="mt-1 text-3xl font-semibold tabular-nums"
          style={accent ? { color: accent } : undefined}
        >
          <NumberTicker value={value} decimalPlaces={decimalPlaces} suffix={suffix} />
        </p>
      </CardContent>
    </Card>
  );
}

interface Props {
  canCompare: boolean;
  currentUserId: string;
}

export function MetricsClient({ canCompare, currentUserId }: Props) {
  const [owner, setOwner] = useState<string>(ALL);
  const selectedOwner = owner === ALL ? null : owner;
  const { data, isLoading, isError } = useAttendantMetrics(selectedOwner);
  // Opções do filtro: só manager+ (a rota /team é manager+). Agent nem vê o filtro.
  const team = useTeamMembers({ enabled: canCompare });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (isError || !data) return <p className="text-sm text-destructive">Erro ao carregar métricas.</p>;

  const metrics = data.data;
  const funnelTotal = metrics.funnel.reduce((acc, s) => acc + s.count, 0);

  const totalGanhos = metrics.attendants.reduce((acc, a) => acc + a.won, 0);
  const totalPerdidos = metrics.attendants.reduce((acc, a) => acc + a.lost, 0);
  const decididos = totalGanhos + totalPerdidos;
  const taxaConversao = decididos > 0 ? (totalGanhos / decididos) * 100 : 0;

  const attendantChartData = metrics.attendants.map((a) => ({
    name: attendantLabel(a),
    Ganhos: a.won,
    Perdidos: a.lost,
  }));

  return (
    <div className="flex flex-col gap-6">
      {canCompare ? (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Atendente</span>
          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Todos os atendentes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os atendentes</SelectItem>
              {(team.data?.data ?? [])
                .filter((m) => m.role !== "viewer")
                .map((m) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name ?? m.email ?? m.user_id.slice(0, 8)}
                    {m.user_id === currentUserId ? " (você)" : ""}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {/* Resumo — os 4 números que respondem "como estamos" sem abrir mais nada. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <BlurFade offset={8}>
          <KpiCard label="Aberto no funil" value={funnelTotal} />
        </BlurFade>
        <BlurFade delay={0.04} offset={8}>
          <KpiCard label="Ganhos (30 dias)" value={totalGanhos} accent="var(--color-success)" />
        </BlurFade>
        <BlurFade delay={0.08} offset={8}>
          <KpiCard label="Perdidos (30 dias)" value={totalPerdidos} accent="var(--color-error)" />
        </BlurFade>
        <BlurFade delay={0.12} offset={8}>
          <KpiCard label="Taxa de conversão" value={taxaConversao} decimalPlaces={1} suffix="%" />
        </BlurFade>
      </div>

      {/* Acima do funil e da performance de propósito: é o número do sistema
          inteiro, ao qual as métricas de área se subordinam (doutrina §3.6).
          Não filtra por atendente — atrito é propriedade do sistema, e quebrá-lo
          por pessoa convida a otimização local que degrada o todo. */}
      <BlurFade delay={0.16} offset={8}>
        <AtritoPanel podeEditarRegua={canCompare} />
      </BlurFade>

      <BlurFade delay={0.2} offset={8}>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Funil {selectedOwner ? "do atendente" : ""} · {funnelTotal}{" "}
              {funnelTotal === 1 ? "aberto" : "abertos"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.funnel.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma etapa configurada.</p>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(160, metrics.funnel.length * 48)}>
                <BarChart
                  data={metrics.funnel}
                  layout="vertical"
                  margin={{ top: 4, right: 24, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border/50" />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="stage_name"
                    width={130}
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    formatter={(value) => [value, "Leads"]}
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "var(--muted)" }}
                  />
                  <Bar dataKey="count" fill="var(--primary)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </BlurFade>

      <BlurFade delay={0.24} offset={8}>
        <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {canCompare ? "Performance por atendente" : "Sua performance"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {metrics.attendants.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sem atividade no período (ganhos/perdidos, conversas ou respostas).
            </p>
          ) : (
            <>
              {canCompare && attendantChartData.length > 1 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={attendantChartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      angle={-15}
                      textAnchor="end"
                      height={48}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={30}
                    />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Ganhos" fill="var(--color-success)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Perdidos" fill="var(--color-error)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : null}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Atendente</TableHead>
                    <TableHead className="text-right">Ganhos</TableHead>
                    <TableHead className="text-right">Perdidos</TableHead>
                    <TableHead className="text-right">Conversas</TableHead>
                    <TableHead className="text-right">1ª resposta (média)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metrics.attendants.map((a) => (
                    <TableRow key={a.user_id}>
                      <TableCell className="font-medium">
                        {attendantLabel(a)}
                        {a.user_id === currentUserId ? (
                          <span className="text-muted-foreground"> (você)</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{a.won}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.lost}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.conversations_handled}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatDuration(a.avg_first_response_seconds)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
        </Card>
      </BlurFade>
    </div>
  );
}
