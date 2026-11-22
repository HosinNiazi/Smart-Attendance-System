import { useId, useState } from "react";
import { Icon } from "./shared.jsx";
import { trendSeries, heatmapMatrix } from "../config/landingAnalytics.js";

const CHART = {
  width: 640,
  height: 250,
  top: 26,
  right: 28,
  bottom: 36,
  left: 42,
};

function buildCurve(points) {
  if (!points.length) return "";
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1];
    const current = points[i];
    const midX = (previous.x + current.x) / 2;
    d += ` C ${midX} ${previous.y}, ${midX} ${current.y}, ${current.x} ${current.y}`;
  }
  return d;
}

function TrendChart({ copy, rtl, digits, granularity }) {
  const [hovered, setHovered] = useState(null);
  const values = trendSeries[granularity];
  const labels =
    granularity === "week"
      ? copy.analyticsWeekLabels
      : copy.analyticsMonthLabels;

  const innerW = CHART.width - CHART.left - CHART.right;
  const innerH = CHART.height - CHART.top - CHART.bottom;
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;

  const xFor = (index) =>
    CHART.left + (rtl ? (values.length - 1 - index) * stepX : index * stepX);
  const yFor = (value) => CHART.top + innerH - (value / 100) * innerH;

  const points = values.map((value, index) => ({
    x: xFor(index),
    y: yFor(value),
    value,
    index,
  }));
  const line = buildCurve(points);
  const baseY = CHART.top + innerH;
  const area = `${line} L ${points[points.length - 1].x} ${baseY} L ${points[0].x} ${baseY} Z`;
  const axisLabelX = rtl ? CHART.width - CHART.right + 8 : CHART.left - 8;
  const axisAnchor = rtl ? "start" : "end";
  const active = hovered === null ? null : points[hovered];

  return (
    <div className="analytics-chart">
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={copy.analyticsTrendTitle}
      >
        <defs>
          <linearGradient id="analytics-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4361ee" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#4361ee" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={tick}>
            <line
              className="analytics-gridline"
              x1={CHART.left}
              x2={CHART.width - CHART.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
            />
            <text
              className="analytics-axis-text"
              x={axisLabelX}
              y={yFor(tick) + 3}
              textAnchor={axisAnchor}
            >
              {digits(tick)}
            </text>
          </g>
        ))}

        <path className="analytics-area" d={area} />
        <path
          className="analytics-line"
          d={line}
          pathLength="1"
          key={granularity}
        />

        {points.map((point) => (
          <g key={point.index}>
            <circle
              className="analytics-dot"
              cx={point.x}
              cy={point.y}
              r={hovered === point.index ? 6 : 4}
            />
            <circle
              className="analytics-hit"
              cx={point.x}
              cy={point.y}
              r={16}
              onMouseEnter={() => setHovered(point.index)}
              onMouseLeave={() => setHovered(null)}
              onClick={() =>
                setHovered((current) =>
                  current === point.index ? null : point.index,
                )
              }
            />
            <text
              className="analytics-axis-text analytics-x-label"
              x={point.x}
              y={CHART.height - 12}
              textAnchor="middle"
            >
              {labels[point.index]}
            </text>
          </g>
        ))}

        {active && (
          <g
            className="analytics-tooltip"
            transform={`translate(${Math.min(
              Math.max(active.x, 44),
              CHART.width - 44,
            )}, ${Math.max(active.y - 34, 14)})`}
            pointerEvents="none"
          >
            <rect x="-42" y="-24" width="84" height="30" rx="9" />
            <text x="0" y="-4" textAnchor="middle">
              {digits(active.value)}
              {copy.analyticsPercent}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function HeatMap({ copy, digits }) {
  const flat = heatmapMatrix.flat();
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const span = max - min || 1;

  return (
    <div className="analytics-heat">
      <div
        className="analytics-heat-body"
        role="img"
        aria-label={copy.analyticsHeatAria}
      >
        {heatmapMatrix.map((row, rowIndex) => (
          <div className="analytics-heat-row" key={copy.analyticsHeatDays[rowIndex]}>
            <span className="analytics-heat-day">
              {copy.analyticsHeatDays[rowIndex]}
            </span>
            <div className="analytics-heat-cells">
              {row.map((value, columnIndex) => (
                <span
                  key={copy.analyticsHeatSlots[columnIndex]}
                  className="analytics-heat-cell"
                  style={{
                    "--heat": (
                      0.12 +
                      ((value - min) / span) * 0.88
                    ).toFixed(2),
                  }}
                  title={`${copy.analyticsHeatDays[rowIndex]} · ${
                    copy.analyticsHeatSlots[columnIndex]
                  } · ${digits(value)}${copy.analyticsPercent}`}
                />
              ))}
            </div>
          </div>
        ))}
        <div className="analytics-heat-row analytics-heat-slots">
          <span className="analytics-heat-day" />
          <div className="analytics-heat-cells">
            {copy.analyticsHeatSlots.map((slot) => (
              <span key={slot}>{slot}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="analytics-heat-legend">
        <span>{copy.analyticsHeatLess}</span>
        <i aria-hidden="true" />
        <span>{copy.analyticsHeatMore}</span>
      </div>
    </div>
  );
}

function KpiCards({ copy, digits }) {
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [openKey, setOpenKey] = useState(copy.analyticsKpis[0]?.key ?? null);

  return (
    <div className="analytics-kpis">
      {copy.analyticsKpis.map((card) => {
        const isOpen = openKey === card.key;
        const panelId = `${baseId}-${card.key}`;
        return (
          <article
            className={`analytics-kpi${isOpen ? " is-open" : ""}`}
            key={card.key}
          >
            <button
              type="button"
              className="analytics-kpi-toggle"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenKey(isOpen ? null : card.key)}
            >
              <span className={`analytics-kpi-icon landing-tone-${card.tone}`}>
                <Icon name={card.icon} />
              </span>
              <span className="analytics-kpi-copy">
                <span className="analytics-kpi-label">{card.label}</span>
                <strong>
                  {digits(card.value)}
                  {card.suffix || ""}
                </strong>
                <small>{card.hint}</small>
              </span>
              <span className="analytics-kpi-chevron">
                <Icon name="bi-chevron-down" />
              </span>
            </button>
            <div
              className={`analytics-kpi-panel${isOpen ? " is-open" : ""}`}
              id={panelId}
            >
              <div className="analytics-kpi-panel-inner">
                <ul className="analytics-breakdown">
                  {card.breakdown.map((row) => (
                    <li key={row.label}>
                      <div className="analytics-breakdown-top">
                        <span>{row.label}</span>
                        <strong>
                          {digits(row.value)}
                          {card.suffix || ""}
                        </strong>
                      </div>
                      <span className="analytics-breakdown-track">
                        <i
                          className={`tone-${row.tone}`}
                          style={{ width: `${row.percent}%` }}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function LandingAnalytics({ copy, rtl, digits }) {
  const [granularity, setGranularity] = useState("week");

  return (
    <section className="landing-section landing-analytics" id="analytics" data-reveal>
      <div className="landing-section-head">
        <span className="landing-eyebrow">{copy.analyticsHead.eyebrow}</span>
        <h2>{copy.analyticsHead.title}</h2>
        <p>{copy.analyticsHead.text}</p>
      </div>

      <div className="analytics-board">
        <div className="analytics-board-head">
          <div className="analytics-board-title">
            <h3>{copy.analyticsTrendTitle}</h3>
            <p>{copy.analyticsTrendHint}</p>
          </div>
          <div className="analytics-board-actions">
            <span className="analytics-sample-badge">
              <Icon name="bi-stars" /> {copy.analyticsSample}
            </span>
            <div className="analytics-toggle" role="group" aria-label={copy.analyticsTrendTitle}>
              <button
                type="button"
                aria-pressed={granularity === "week"}
                onClick={() => setGranularity("week")}
              >
                {copy.analyticsWeekly}
              </button>
              <button
                type="button"
                aria-pressed={granularity === "month"}
                onClick={() => setGranularity("month")}
              >
                {copy.analyticsMonthly}
              </button>
            </div>
          </div>
        </div>
        <TrendChart
          copy={copy}
          rtl={rtl}
          digits={digits}
          granularity={granularity}
        />
      </div>

      <div className="analytics-lower">
        <div className="analytics-card">
          <div className="analytics-card-head">
            <h3>{copy.analyticsHeatTitle}</h3>
            <p>{copy.analyticsHeatText}</p>
          </div>
          <HeatMap copy={copy} digits={digits} />
        </div>
        <div className="analytics-card">
          <div className="analytics-card-head">
            <h3>{copy.analyticsKpisTitle}</h3>
          </div>
          <KpiCards copy={copy} digits={digits} />
        </div>
      </div>
    </section>
  );
}
