import Link from "next/link";
import { getUiCopy } from "../lib/i18n/ui-copy";
import { sampleScenario } from "../lib/pipeline/sample-scenario";
import { listAsyncSessions } from "../lib/pipeline/async-run-store";
import { listStoredScenarioSummaries } from "../lib/scenarios/scenario-store";
import SessionsList from "../components/home/SessionsList";
import ScenariosPanel, { type HomeScenarioItem } from "../components/home/ScenariosPanel";

export default async function HomePage() {
  const copy = getUiCopy("ru");
  const sessions = listAsyncSessions();
  const storedScenarios = await listStoredScenarioSummaries();
  const scenarios: HomeScenarioItem[] = [
    {
      id: sampleScenario.id,
      name: sampleScenario.name,
      source: "builtin",
      latestVersion: null,
      updatedAt: null,
    },
    ...storedScenarios.map((s) => ({
      id: s.id,
      name: s.name,
      source: "stored" as const,
      latestVersion: s.latestVersion,
      updatedAt: s.updatedAt,
    })),
  ];

  return (
    <main>
      <div className="stack tile-grid">
        <div className="card">
          <h1>{copy.home.title}</h1>
          <p>{copy.home.subtitle}</p>
          <p>
            <Link href="/sessions/new">{copy.home.cta}</Link>
          </p>
          <p>
            <Link href="/scenarios/build">{copy.home.pipelineBuilderLink}</Link>
          </p>
        </div>

        <div className="home-dual-col">
          <div className="card stack">
            <SessionsList sessions={sessions} />
          </div>
          <div className="card stack">
            <ScenariosPanel scenarios={scenarios} />
          </div>
        </div>

        <div className="card">
          <h2>{copy.home.apiTitle}</h2>
          <ul>
            <li>`POST /api/pipeline/run`</li>
            <li>`GET /api/scenarios` · `POST /api/scenarios` · `GET /api/scenarios/[id]`</li>
            <li>`GET /api/sessions`</li>
            <li>`GET /api/sessions/[id]/status`</li>
            <li>`GET /api/sessions/[id]/report`</li>
            <li>`POST /api/scenarios/[id]/validate`</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
