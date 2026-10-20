import { describe } from './model.js';
const project = { name: 'Harbor', files: ['main.py'] };
export const summary = describe(project);
export function App() {
  return <main aria-label="Workspace"><h1>{summary}</h1></main>;
}
