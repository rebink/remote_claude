<script lang="ts">
  import "./styles/tokens.css";
  import { onMount } from "svelte";
  import { loadConnections, loadProjects } from "./lib/stores";
  import Connections from "./screens/Connections.svelte";
  import Projects from "./screens/Projects.svelte";
  import Workspace from "./screens/Workspace.svelte";
  import SetupWizard from "./screens/SetupWizard.svelte";
  import AddProject from "./screens/AddProject.svelte";
  import type { Connection, Project } from "./lib/types";

  let selectedConn = $state<Connection | null>(null);
  let addingConn = $state(false);
  let addingProj = $state(false);
  let opened = $state<Project | null>(null);

  onMount(async () => { await loadConnections(); await loadProjects(); });

  async function onConnectionAdded() { addingConn = false; await loadConnections(); }
</script>

<div data-testid="app-root" class="app">
  {#if opened}
    <Workspace project={opened} onback={() => (opened = null)} />
  {:else if addingConn}
    <SetupWizard onfinish={onConnectionAdded} onback={() => (addingConn = false)} />
  {:else if selectedConn && addingProj}
    <AddProject connection={selectedConn} onfinish={async () => { addingProj = false; await loadProjects(); }} onback={() => (addingProj = false)} />
  {:else if selectedConn}
    <Projects connection={selectedConn} onopen={(p) => (opened = p)} onadd={() => (addingProj = true)} onback={() => (selectedConn = null)} />
  {:else}
    <Connections onselect={(c) => (selectedConn = c)} onadd={() => (addingConn = true)} />
  {/if}
</div>

<style>.app { height: 100%; }</style>
