import { requireSession } from "@/lib/auth";
import { FINAL_EXAM, IRT, LEVEL_FLOOR, LEVEL_LABEL } from "@/lib/irt";
import { STRIKE_LIMIT } from "@/lib/integrity";
import { Card, PageHeader } from "@/components/ui";

/**
 * The trainee guide. Pages link to its sections ("How this works") instead of
 * carrying their own instructions. Every number comes from the same config
 * the test engine uses, so the guide cannot drift from the rules.
 */
export default async function GuidePage() {
  await requireSession();

  return (
    <div className="mx-auto max-w-[60rem]">
      <PageHeader
        title="How training works"
        description="Read the chapters, pass each module test, then the final exam."
      />
      <div className="grid gap-6 lg:grid-cols-[180px_1fr]">
        <nav aria-label="On this page" className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">On this page</div>
          <ol className="flex flex-wrap gap-2 lg:flex-col lg:gap-0.5">
            {SECTIONS.map(({ id, title }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block rounded border border-line bg-panel px-3 py-1.5 text-sm font-semibold text-ink hover:border-teal hover:text-teal lg:border-transparent lg:bg-transparent lg:px-2"
                >
                  {title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="min-w-0 space-y-4">
          <Section id="track">
            <p>
              A track is a set of modules taken in order. Each module has chapters to read and ends with a test. Pass a
              module&apos;s test to earn its badge; the next module opens once you have it.
            </p>
            <p>A lock means something is not open yet. Your dashboard always shows the next thing to do.</p>
          </Section>

          <Section id="chapters">
            <p>
              Chapters open one at a time. When you finish one, press <strong>Mark as complete</strong>: it gets a tick
              and the next chapter opens. Once every chapter in a module has a tick, its test opens.
            </p>
            <p>You can go back and reread any chapter you have completed at any time.</p>
          </Section>

          <Section id="tests">
            <div className="grid gap-3 sm:grid-cols-2">
              <Fact
                label="Module test"
                value={`${IRT.minQuestions}–${IRT.maxQuestions} questions · ${IRT.timeLimitMinutes} min`}
              />
              <Fact
                label="Final exam"
                value={`${FINAL_EXAM.minQuestions}–${FINAL_EXAM.maxQuestions} questions · ${FINAL_EXAM.timeLimitMinutes} min`}
              />
            </div>
            <ul>
              <li>
                The test is adaptive: each question is chosen based on your answers so far, so no two tests are the same
                and the length varies. It stops as soon as it is sure of your level.
              </li>
              <li>The test runs in fullscreen. The clock starts when the first question appears.</li>
              <li>
                Leaving fullscreen, switching tabs, copying, pasting or right-clicking each count as a warning. After{" "}
                {STRIKE_LIMIT} warnings, the next one ends the attempt.
              </li>
              <li>If time runs out, the test ends with the answers you have given.</li>
            </ul>
          </Section>

          <Section id="levels">
            <p>
              A pass earns a badge at one of three levels. Each level also needs a minimum share of correct answers:
            </p>
            <ul>
              {(["SATISFACTORY", "PROFICIENT", "EXPERT"] as const).map((level) => (
                <li key={level}>
                  <strong>{LEVEL_LABEL[level]}</strong>: at least {LEVEL_FLOOR[level]}% correct
                </li>
              ))}
            </ul>
            <p>
              <strong>Too close to call</strong> means the test could not tell whether you passed. Nothing goes on your
              record and you can take it again straight away.
            </p>
            <p>
              If you do not pass, the result lists the chapters behind the questions you missed. Reread those first.
            </p>
          </Section>

          <Section id="retakes">
            <ul>
              <li>
                After a pass, a fail or an attempt ended for warnings, you can retake after {IRT.cooldownHours} hours.
              </li>
              <li>
                No wait after a &quot;too close to call&quot; result, or when time runs out before you have answered the
                test&apos;s minimum number of questions.
              </li>
              <li>Your best level stands: a lower result on a retake never replaces a higher badge.</li>
            </ul>
          </Section>

          <Section id="final-exam">
            <p>
              Once every module in the track has a badge, the final exam opens. It covers every module evenly and awards
              the track certificate, with a level worked out the same way as for badges.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

/** In page order; the ids are what "How this works" links point at. */
const SECTIONS = [
  { id: "track", title: "The track" },
  { id: "chapters", title: "Chapters" },
  { id: "tests", title: "Taking a test" },
  { id: "levels", title: "Levels and results" },
  { id: "retakes", title: "Retakes" },
  { id: "final-exam", title: "The final exam" }
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function Section({ id, children }: { id: SectionId; children: React.ReactNode }) {
  const title = SECTIONS.find((section) => section.id === id)!.title;
  // The id sits on the card itself, so a jump to it lands with the whole card in view.
  return (
    <section id={id} className="scroll-mt-6">
      <Card className="p-5 sm:p-6">
        <div className="chapter-body">
          <h2 className="border-b border-line pb-2">{title}</h2>
          {children}
        </div>
      </Card>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-wash px-4 py-3">
      <div className="text-xs font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 font-semibold text-ink">{value}</div>
    </div>
  );
}
