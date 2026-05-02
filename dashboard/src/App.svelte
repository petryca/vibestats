<script>
  import { onMount } from 'svelte';
  import { fetchStats, getDomainFromPath } from './api.js';
  import LineChart from './lib/LineChart.svelte';
  import BarList from './lib/BarList.svelte';

  const ranges = [
    { label: '7d', days: 7 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
    { label: '1y', days: 365 },
  ];

  let domain = getDomainFromPath();
  let days = 30;
  let stats = null;
  let error = null;
  let loading = false;

  async function load() {
    if (!domain) return;
    loading = true;
    error = null;
    try {
      stats = await fetchStats(domain, days);
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  onMount(load);
  $: if (domain) { days; load(); }

  function fmtReferrer(r) {
    if (r === '(direct)') return 'Direct / none';
    try {
      const u = new URL(r);
      return u.hostname + (u.pathname && u.pathname !== '/' ? u.pathname : '');
    } catch { return r; }
  }
</script>

<main class="app">
  <header class="header">
    <h1 class="title">
      <span class="brand">vibestats /</span>
      <span class="domain">{domain || '?'}</span>
    </h1>
    <div class="range" role="tablist">
      {#each ranges as r}
        <button
          class:active={days === r.days}
          on:click={() => (days = r.days)}
          role="tab"
          aria-selected={days === r.days}
        >{r.label}</button>
      {/each}
    </div>
  </header>

  {#if !domain}
    <div class="error">No domain in URL. Visit <code>/yourdomain.com/</code>.</div>
  {:else if error}
    <div class="error">Error: {error}</div>
  {:else if !stats}
    <div class="empty">{loading ? 'Loading…' : ''}</div>
  {:else}
    <section class="totals">
      <div class="kpi">
        <div class="label">Visitors</div>
        <div class="value">{stats.totals.visitors.toLocaleString()}</div>
      </div>
      <div class="kpi">
        <div class="label">Page views</div>
        <div class="value">{stats.totals.page_views.toLocaleString()}</div>
      </div>
      <div class="kpi">
        <div class="label">Views / visitor</div>
        <div class="value">
          {stats.totals.visitors ? (stats.totals.page_views / stats.totals.visitors).toFixed(2) : '—'}
        </div>
      </div>
      <div class="kpi">
        <div class="label">Range</div>
        <div class="value">{stats.days}d</div>
      </div>
    </section>

    <section class="card" style="margin-bottom:1rem">
      <h2>Daily traffic</h2>
      <LineChart data={stats.daily} />
    </section>

    <section class="grid cols-2">
      <div class="card">
        <h2>Top countries</h2>
        <BarList rows={stats.countries} />
      </div>
      <div class="card">
        <h2>Top pages</h2>
        <BarList rows={stats.pages} />
      </div>
      <div class="card">
        <h2>Operating systems</h2>
        <BarList rows={stats.oses} />
      </div>
      <div class="card">
        <h2>Browsers</h2>
        <BarList rows={stats.browsers} />
      </div>
      <div class="card">
        <h2>Top referrers</h2>
        <BarList rows={stats.referrers} formatKey={fmtReferrer} />
      </div>
      <div class="card">
        <h2>Search terms</h2>
        <BarList rows={stats.searches} />
      </div>
    </section>

    <footer class="footer">vibestats · {stats.totals.page_views} events tracked in last {stats.days} days</footer>
  {/if}
</main>
