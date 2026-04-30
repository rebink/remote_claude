import chalk from 'chalk';

const verbose = process.env.DEVBRIDGE_VERBOSE === '1';

export const log = {
  info: (msg: string) => console.log(chalk.cyan('›'), msg),
  ok: (msg: string) => console.log(chalk.green('✓'), msg),
  warn: (msg: string) => console.log(chalk.yellow('!'), msg),
  err: (msg: string) => console.error(chalk.red('✗'), msg),
  step: (msg: string) => console.log(chalk.bold(msg)),
  dim: (msg: string) => console.log(chalk.dim(msg)),
  debug: (msg: string) => {
    if (verbose) console.log(chalk.magenta('debug'), msg);
  },
};
