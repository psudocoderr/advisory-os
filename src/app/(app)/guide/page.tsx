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
    <>
      <PageHeader
        title="How training works"
        description="Read the chapters, pass each module test, then the final exam."
      />
      <div className="max-w-3xl space-y-4">
        <Section id="track" title="The track">
          <p>
            A track is a set of modules taken in order. Each module has chapters to read and ends with a test. Pass a
            module&apos;s test to earn its badge; the next module opens once you have it.
          </p>
          <p>A lock means something is not open yet. Your dashboard always shows the next thing to do.</p>
        </Section>

        <Section id="chapters" title="Chapters">
          <p>
            Chapters open one at a time. When you finish one, press <strong>Mark as complete</strong>: it gets a tick
            and the next chapter opens. Once every chapter in a module has a tick, its test opens.
          </p>
          <p>You can go back and reread any chapter you have completed at any time.</p>
        </Section>

        <Section id="tests" title="Taking a test">
          <ul>
            <li>
              A module test has {IRT.minQuestions} to {IRT.maxQuestions} questions and {IRT.timeLimitMinutes} minutes.
              The final exam has {FINAL_EXAM.minQuestions} to {FINAL_EXAM.maxQuestions} questions and{" "}
              {FINAL_EXAM.timeLimitMinutes} minutes.
            </li>
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

        <Section id="levels" title="Levels and results">
          <p>A pass earns a badge at one of three levels. Each level also needs a minimum share of correct answers:</p>
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
          <p>If you do not pass, the result lists the chapters behind the questions you missed. Reread those first.</p>
        </Section>

        <Section id="retakes" title="Retakes">
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

        <Section id="final-exam" title="The final exam">
          <p>
            Once every module in the track has a badge, the final exam opens. It covers every module evenly and awards
            the track certificate, with a level worked out the same way as for badges.
          </p>
        </Section>
      </div>
    </>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card className="scroll-mt-6 p-5">
      <section id={id} className="chapter-body">
        <h2>{title}</h2>
        {children}
      </section>
    </Card>
  );
}
