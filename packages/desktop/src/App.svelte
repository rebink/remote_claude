<script lang="ts">
  import "./styles/tokens.css";
  import { onMount } from "svelte";
  import { connection, projects, route, loadConnection, loadProjects } from "./lib/stores";
  import Connect from "./screens/Connect.svelte";
  import Projects from "./screens/Projects.svelte";
  import Workspace from "./screens/Workspace.svelte";
  import AddProjectDialog from "./components/AddProjectDialog.svelte";
  import type { Connection, Project } from "./lib/types";

  let adding = $state(false);
  let opened = $state<Project | null>(null);

  onMount(async () => {
    await loadConnection();
    if ($connection) await loadProjects();
  });

  async function onconnected(c: Connection) {
    connection.set(c);
    await loadProjects();
  }

  async function onsaved() {
    adding = false;
    await loadProjects();
  }
</script>

<div data-testid="app-root" class="app">
  {#if $route === "connect"}
    <Connect {onconnected} />
  {:else if opened}
    <Workspace project={opened} onback={() => (opened = null)} />
  {:else if adding}
    <AddProjectDialog {onsaved} oncancel={() => (adding = false)} />
  {:else}
    <Projects onopen={(p) => (opened = p)} onadd={() => (adding = true)} />
  {/if}
</div>

<style>
  .app { height: 100%; }
</style>
