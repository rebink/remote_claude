import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const repo = 'https://github.com/rebink/remote_claude';

export default defineConfig({
  site: 'https://remote-claude.vercel.app',
  integrations: [
    starlight({
      title: 'Remote Claude',
      description:
        'Local-first dev tool: push your project to a remote Mac, run Claude Code there, and pull back a reviewable unified diff.',
      logo: { src: './src/assets/logo.svg', replacesTitle: false },
      social: { github: repo },
      editLink: {
        baseUrl: `${repo}/edit/main/website/`,
      },
      lastUpdated: true,
      pagination: true,
      customCss: ['./src/styles/custom.css'],
      head: [
        {
          tag: 'meta',
          attrs: { name: 'theme-color', content: '#0a0a0a' },
        },
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Introduction', slug: 'introduction' },
            { label: 'Quickstart', slug: 'quickstart' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Architecture', slug: 'architecture' },
            { label: 'Why a remote agent?', slug: 'why' },
          ],
        },
        {
          label: 'Setup',
          items: [
            { label: 'Networking (Tailscale)', slug: 'networking' },
            { label: 'Configuration', slug: 'configuration' },
            { label: 'Running the agent', slug: 'agent' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI commands', slug: 'commands' },
            { label: 'HTTP API', slug: 'api' },
            { label: 'Security model', slug: 'security' },
          ],
        },
        {
          label: 'Help',
          items: [
            { label: 'Troubleshooting', slug: 'troubleshooting' },
            { label: 'FAQ', slug: 'faq' },
            { label: 'Roadmap', slug: 'roadmap' },
          ],
        },
      ],
    }),
  ],
});
