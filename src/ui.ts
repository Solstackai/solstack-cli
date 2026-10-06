import { styleText } from 'node:util';

type Style = Parameters<typeof styleText>[0];

const color = (style: Style) => (text: string) => (process.stdout.isTTY ? styleText(style, text) : text);

export const bold = color('bold');
export const dim = color('dim');
export const green = color('green');
export const red = color('red');
export const yellow = color('yellow');
export const cyan = color('cyan');

export const ok = (text: string) => `${green('✓')} ${text}`;
export const fail = (text: string) => `${red('✗')} ${text}`;
export const warn = (text: string) => `${yellow('!')} ${text}`;

/** An error that should be shown to the user as-is, without a stack trace. */
export class UserError extends Error {}
