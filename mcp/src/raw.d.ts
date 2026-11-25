/** `import text from './file.md?raw'`: build.mjs and Vitest load the file as a string. */
declare module '*?raw' {
  const text: string;
  export default text;
}
