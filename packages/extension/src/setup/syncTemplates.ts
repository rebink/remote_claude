export type ProjectType = 'flutter' | 'node-frontend' | 'node-backend' | 'python' | 'common';

export const PROJECT_TYPES: ProjectType[] = ['flutter', 'node-frontend', 'node-backend', 'python', 'common'];

// Always merged in (OS / editor junk). Never lists .patchwire-inbox/ — it must sync.
const COMMON = ['.DS_Store', 'Thumbs.db', '*.swp', '.idea/'];

export const EXCLUDE_TEMPLATES: Record<ProjectType, string[]> = {
  common: [...COMMON],
  flutter: [...COMMON, 'build/', '.dart_tool/', '**/Pods/', 'ios/.symlinks/',
    'android/.gradle/', '.flutter-plugins', '.flutter-plugins-dependencies', '**/*.iml'],
  'node-frontend': [...COMMON, 'node_modules/', 'dist/', 'build/', '.next/', '.nuxt/',
    '.svelte-kit/', '.vite/', '.turbo/', '.cache/', '.parcel-cache/', 'coverage/'],
  'node-backend': [...COMMON, 'node_modules/', 'dist/', 'build/', 'coverage/', '.turbo/', 'logs/', 'tmp/'],
  python: [...COMMON, '__pycache__/', '*.pyc', '.venv/', 'venv/', '.mypy_cache/',
    '.pytest_cache/', '.ruff_cache/', '*.egg-info/', '.tox/', 'build/', 'dist/'],
};

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  flutter: 'Flutter / Dart',
  'node-frontend': 'Node — web / frontend',
  'node-backend': 'Node — backend / service',
  python: 'Python',
  common: 'Common (minimal)',
};
