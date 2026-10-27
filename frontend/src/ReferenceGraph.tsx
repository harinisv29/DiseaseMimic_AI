import { useMemo, useState } from "react";

import {
  ReactFlow,
  Background,
  Controls,
  Position,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";

import { Network, RotateCcw } from "lucide-react";

import type { Evidence, Observation } from "./api";

import { Badge, Button, Card } from "./components/ui";

export default function ReferenceGraph({
  diseases,
  observations,
}: {
  diseases: Evidence[];
  observations: Observation[];
}) {
  const [focus, setFocus] = useState("all");
  const [shared, setShared] = useState(false);
  const [selected, setSelected] = useState(
    "Click a node to inspect its reference context.",
  );
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);

  const { nodes, edges, limited } = useMemo(() => {
    const filtered =
      focus === "all" ? diseases : diseases.filter((d) => d.id === focus);

    const candidates = new Map<string, { label: string; count: number }>();

    filtered.forEach((d) =>
      d.phenotypes
        .filter((p) => p.state === "present")
        .forEach((p) =>
          candidates.set(p.id, {
            label: p.label,
            count: (candidates.get(p.id)?.count || 0) + 1,
          }),
        ),
    );

    const observed = new Map(observations.map((p) => [p.id, p.state]));

    const phenotypes = [...candidates]
      .sort(
        (a, b) =>
          Number(observed.has(b[0])) - Number(observed.has(a[0])) ||
          b[1].count - a[1].count ||
          a[1].label.localeCompare(b[1].label),
      )
      .slice(0, 10);

    const nodes: Node[] = [
      ...filtered.map((d, i) => ({
        id: d.id,
        position: { x: 10, y: 50 + i * 170 },
        data: {
          label: (
            <span title={`${d.label} (${d.id})`}>
              {d.label}
              <small>{d.id}</small>
            </span>
          ),
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        style: {
          background: "#eef4ff",
          border: "1px solid #9bbbed",
          color: "#234875",
          width: 225,
          borderRadius: 12,
          padding: 14,
        },
      })),
      ...phenotypes.map(([id, p], i) => ({
        id,
        position: { x: 420, y: i * 66 },
        data: {
          label: (
            <span title={`${p.label} (${id})`}>
              {p.label}
              <small>
                {id}
                {p.count > 1 ? " · Shared" : ""}
              </small>
            </span>
          ),
        },
        targetPosition: Position.Left,
        style: {
          background: shared && p.count > 1 ? "#ccfbf1" : "#f0fdfa",
          border: `${observed.has(id) ? "2" : "1"}px ${observed.get(id) === "absent" ? "dashed" : "solid"} ${observed.get(id) === "absent" ? "#be5672" : observed.has(id) ? "#0f5e66" : "#99d5cd"}`,
          color: "#125e59",
          width: 225,
          borderRadius: 10,
          padding: 10,
        },
      })),
    ];

    const edges: Edge[] = filtered.flatMap((d) =>
      phenotypes
        .filter(([id]) =>
          d.phenotypes.some((p) => p.id === id && p.state === "present"),
        )
        .map(([id, p]) => ({
          id: `${d.id}-${id}`,
          source: d.id,
          target: id,
          style: {
            stroke: shared && p.count > 1 ? "#0d9488" : "#b4c9d7",
            strokeWidth: shared && p.count > 1 ? 2 : 1,
            opacity: shared && p.count === 1 ? 0.3 : 1,
          },
        })),
    );

    return { nodes, edges, limited: candidates.size > 10 };
  }, [diseases, observations, focus, shared]);

  return (
    <Card className="overflow-hidden">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">REFERENCE NETWORK</div>
          <h2>
            <Network size={19} />
            Disease–phenotype connections
          </h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setFocus("all");
            setShared(false);
            setTimeout(() => flow?.fitView({ padding: 0.15 }), 50);
          }}
        >
          <RotateCcw size={14} />
          Reset
        </Button>
      </div>
      <div className="graph-toolbar">
        <label>
          Focus{" "}
          <select
            aria-label="Focus graph on disease"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
          >
            <option value="all">All compared candidates</option>
            {diseases.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={shared}
            onChange={(e) => setShared(e.target.checked)}
          />{" "}
          Highlight shared
        </label>
      </div>
      <div className="graph-canvas">
        <ReactFlow
          key={focus}
          nodes={nodes}
          edges={edges}
          onInit={setFlow}
          nodesDraggable={false}
          nodesConnectable={false}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          onNodeClick={(_, node) =>
            setSelected(
              node.id.startsWith("HP:")
                ? `${node.id}: connected only where a positive source association is documented.`
                : `${node.id}: showing source-derived phenotype associations.`,
            )
          }
          minZoom={0.25}
        >
          <Background gap={20} color="#dce5e9" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="graph-legend">
        <span>
          <i className="legend-disease" />
          Disease
        </span>
        <span>
          <i className="legend-phenotype" />
          Reference phenotype
        </span>
        <span>
          <i className="legend-observed" />
          Patient observed
        </span>
      </div>
      <p className="graph-caption" aria-live="polite">
        {selected} {limited ? "View limited to 10 relevant phenotypes." : ""}
      </p>
    </Card>
  );
}
