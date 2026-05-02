<script>
  import { scaleTime, scaleLinear } from 'd3-scale';
  import { line, area, curveMonotoneX } from 'd3-shape';
  import { extent, max } from 'd3-array';
  import { timeFormat } from 'd3-time-format';

  export let data = []; // [{day, visitors, page_views}]

  let width = 600;
  const height = 260;
  const margin = { top: 12, right: 16, bottom: 28, left: 36 };

  const fmtDate = timeFormat('%b %-d');
  const fmtFull = timeFormat('%a %b %-d');

  $: parsed = data.map((d) => ({
    date: new Date(d.day),
    visitors: +d.visitors,
    page_views: +d.page_views,
  }));

  $: xDomain = parsed.length ? extent(parsed, (d) => d.date) : [new Date(), new Date()];
  $: yMax = parsed.length ? max(parsed, (d) => Math.max(d.page_views, d.visitors)) || 1 : 1;

  $: x = scaleTime().domain(xDomain).range([margin.left, width - margin.right]);
  $: y = scaleLinear().domain([0, yMax * 1.15]).nice().range([height - margin.bottom, margin.top]);

  $: linePV = line().x((d) => x(d.date)).y((d) => y(d.page_views)).curve(curveMonotoneX);
  $: lineV = line().x((d) => x(d.date)).y((d) => y(d.visitors)).curve(curveMonotoneX);
  $: areaPV = area().x((d) => x(d.date)).y0(y(0)).y1((d) => y(d.page_views)).curve(curveMonotoneX);

  $: yTicks = y.ticks(4);
  $: xTicks = x.ticks(Math.max(2, Math.min(parsed.length, 6)));

  let hover = null;
  function onMove(e) {
    if (!parsed.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const date = x.invert(px);
    let nearest = parsed[0];
    let best = Infinity;
    for (const d of parsed) {
      const dist = Math.abs(d.date - date);
      if (dist < best) { best = dist; nearest = d; }
    }
    hover = nearest;
  }
  function onLeave() { hover = null; }
</script>

<div class="wrap" bind:clientWidth={width}>
  {#if parsed.length === 0}
    <div class="empty">No data in this range yet.</div>
  {:else}
    <svg {width} {height} on:mousemove={onMove} on:mouseleave={onLeave} role="img">
      <defs>
        <linearGradient id="pvFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.35" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
        </linearGradient>
      </defs>

      {#each yTicks as t}
        <line x1={margin.left} x2={width - margin.right} y1={y(t)} y2={y(t)} stroke="var(--border)" />
        <text x={margin.left - 8} y={y(t)} dy="0.32em" text-anchor="end" fill="var(--muted)" font-size="11">{t}</text>
      {/each}

      {#each xTicks as t}
        <text x={x(t)} y={height - margin.bottom + 16} text-anchor="middle" fill="var(--muted)" font-size="11">{fmtDate(t)}</text>
      {/each}

      <path d={areaPV(parsed)} fill="url(#pvFill)" />
      <path d={linePV(parsed)} fill="none" stroke="var(--accent)" stroke-width="2" />
      <path d={lineV(parsed)} fill="none" stroke="var(--accent-2)" stroke-width="2" stroke-dasharray="4 3" />

      {#if hover}
        <line x1={x(hover.date)} x2={x(hover.date)} y1={margin.top} y2={height - margin.bottom} stroke="var(--muted)" stroke-dasharray="2 2" />
        <circle cx={x(hover.date)} cy={y(hover.page_views)} r="3.5" fill="var(--accent)" />
        <circle cx={x(hover.date)} cy={y(hover.visitors)} r="3.5" fill="var(--accent-2)" />
      {/if}
    </svg>

    <div class="legend">
      <span><i style="background:var(--accent)"></i>Page views</span>
      <span><i style="background:var(--accent-2)"></i>Visitors</span>
      {#if hover}
        <span class="tip">{fmtFull(hover.date)} · {hover.visitors} visitors · {hover.page_views} views</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrap { width: 100%; }
  .empty { color: var(--muted); padding: 1rem 0; }
  svg { display: block; width: 100%; height: 260px; }
  .legend {
    display: flex; flex-wrap: wrap; gap: 1rem;
    color: var(--muted); font-size: 12px; margin-top: 0.25rem;
  }
  .legend i {
    display: inline-block; width: 10px; height: 10px;
    border-radius: 2px; margin-right: 6px; vertical-align: middle;
  }
  .legend .tip { margin-left: auto; color: var(--text); }
</style>
