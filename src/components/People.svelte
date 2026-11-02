<!--
  Who's here: a face (initials) for everyone on this timeline's links, and, opened, the list with
  who edits and who views, and this page's own name.
-->
<script lang="ts">
  import { CID, type Board, type Person } from '../lib/board.svelte.ts';
  import { prefs, setName } from '../lib/prefs.svelte.ts';
  import { t } from '../lib/i18n.svelte.ts';

  let { board }: { board: Board } = $props();

  let open = $state(false);
  let root: HTMLDivElement;

  const hue = (cid: string) => [...cid].reduce((n, c) => n + c.charCodeAt(0), 0) % 6;
  const initials = (name: string) =>
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => [...w][0]!.toUpperCase())
      .join('') || '?';
  const list = $derived.by(() => {
    const me = board.people.filter((p) => p.cid === CID).slice(0, 1);
    const rest = board.people.filter((p) => p.cid !== CID);
    return [...(me.length ? me : [{ cid: CID, name: prefs.name, role: board.role, hold: null } as Person]), ...rest];
  });
  const shown = $derived(list.slice(0, 4));
  const more = $derived(list.length - shown.length);
  const nameOf = (p: Person) => (p.cid === CID ? prefs.name : p.name) || t('people.guest');

  function outside(e: PointerEvent) {
    if (open && !root.contains(e.target as Node)) open = false;
  }

  let nameTimer: ReturnType<typeof setTimeout> | undefined;
  function rename(value: string) {
    setName(value);
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => board.rename(prefs.name), 500);
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<div class="people" bind:this={root}>
  <button type="button" class="faces" aria-expanded={open} aria-label="{t('people.title')}: {list.length}" onclick={() => (open = !open)}>
    {#each shown as p (p.cid)}
      <span class="av" style:--p="var(--p{hue(p.cid)})" class:me={p.cid === CID}>{initials(nameOf(p))}</span>
    {/each}
    {#if more > 0}<span class="av more">+{more}</span>{/if}
  </button>
  {#if open}
    <div class="pop" role="dialog" aria-label={t('people.title')}>
      <span class="label">{t('people.title')}</span>
      <ul>
        {#each list as p (p.cid)}
          <li>
            <span class="av" style:--p="var(--p{hue(p.cid)})">{initials(nameOf(p))}</span>
            <b>{nameOf(p)}{#if p.cid === CID}<small> ({t('people.you')})</small>{/if}</b>
            <span class="role">{p.role === 'edit' ? t('people.editing') : t('people.viewing')}</span>
          </li>
        {/each}
      </ul>
      {#if board.role === 'edit'}
        <label class="you">
          <span class="label">{t('people.name')}</span>
          <input class="field" value={prefs.name} maxlength="40" placeholder={t('people.namePh')} oninput={(e) => rename(e.currentTarget.value)} />
        </label>
      {/if}
    </div>
  {/if}
</div>

<style>
  .people {
    position: relative;
    flex: none;
  }

  .faces {
    display: inline-flex;
    align-items: center;
    padding: 2px;
    border-radius: 999px;
  }

  .av {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font: 700 10.5px/1 var(--f);
    background: var(--p);
    color: var(--pk);
    box-shadow: 0 0 0 2px var(--axbg);
    flex: none;
  }

  .faces .av + .av {
    margin-left: -6px;
  }

  .av.more {
    background: var(--ground);
    color: var(--ink2);
  }

  .pop {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    z-index: 30;
    width: min(300px, calc(100vw - 32px));
    padding: 14px;
    display: grid;
    gap: 10px;
    border-radius: 16px;
    background: var(--pop);
    color: var(--ink);
    box-shadow:
      0 18px 50px var(--shadow),
      0 0 0 1px var(--rule);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 8px;
  }

  li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  li b {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
  }

  li small {
    font-weight: 500;
    color: var(--ink2);
  }

  .role {
    color: var(--ink2);
    font-size: 12.5px;
  }

  .you {
    display: grid;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid var(--rule);
  }
</style>
