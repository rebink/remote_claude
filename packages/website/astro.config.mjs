import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const repo = 'https://github.com/rebink/patchwire';

export default defineConfig({
  site: 'https://patchwire.vercel.app',
  integrations: [
    starlight({
      title: 'Patchwire',
      description:
        'Local-first dev tool: push your project to a remote Mac, run an AI CLI there, and pull back a reviewable unified diff.',
      // No `logo` config needed — our SiteTitle override below renders
      // the brand mark as inline SVG (not as <img>) so the strokes
      // inherit currentColor from the link, exactly like the landing
      // page's .wordmark. Inline SVG is the only way to get true
      // currentColor inheritance.
      components: {
        Head: './src/components/Head.astro',
        SiteTitle: './src/components/SiteTitle.astro',
        Footer: './src/components/Footer.astro',
      },
      social: { github: repo },
      editLink: {
        baseUrl: `${repo}/edit/main/packages/website/`,
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
            { label: 'Install the extension', slug: 'install-extension' },
            { label: 'Quickstart', slug: 'quickstart' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Architecture', slug: 'architecture' },
            { label: 'Multi-developer', slug: 'multi-developer' },
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
