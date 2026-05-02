<script>
  export let rows = []; // [{key, value}]
  export let formatKey = (k) => k;

  $: max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  $: total = rows.reduce((s, r) => s + r.value, 0) || 1;
</script>

{#if rows.length === 0}
  <div class="empty">No data.</div>
{:else}
  <ul class="list">
    {#each rows as r}
      <li>
        <div class="row">
          <span class="bar" style="width: {(r.value / max) * 100}%"></span>
          <span class="key" title={r.key}>{formatKey(r.key)}</span>
          <span class="val">{r.value}</span>
          <span class="pct">{((r.value / total) * 100).toFixed(1)}%</span>
        </div>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .list { list-style: none; margin: 0; padding: 0; }
  .row {
    position: relative;
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.5rem;
    align-items: center;
    padding: 0.4rem 0.6rem;
    border-radius: 6px;
    overflow: hidden;
  }
  .bar {
    position: absolute;
    inset: 0 auto 0 0;
    background: rgba(124, 92, 255, 0.15);
    border-left: 2px solid var(--accent);
    z-index: 0;
    transition: width 0.3s ease;
  }
  .key, .val, .pct {
    position: relative;
    z-index: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .key { min-width: 0; }
  .val { color: var(--text); font-variant-numeric: tabular-nums; }
  .pct { color: var(--muted); width: 3.5rem; text-align: right; font-variant-numeric: tabular-nums; }
  .empty { color: var(--muted); padding: 0.5rem 0; }
</style>
