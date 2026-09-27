import { CalendarPlus } from "lucide-react";
import { createMeeting } from "@/lib/actions";
import { FormDialog } from "@/components/form-dialog";
import { SubmitButton } from "@/components/ui";

type Party = { id: string; name: string };

/**
 * The one meeting form, on the prospects page, the clients page and the
 * dashboard. "With" names the prospect or client as `prospect:<id>` or
 * `client:<id>`; createMeeting takes the link and the meeting kind from it.
 */
export function LogMeetingDialog({
  label,
  prospects = [],
  clients = [],
  primary = false
}: {
  label: string;
  prospects?: Party[];
  clients?: Party[];
  primary?: boolean;
}) {
  const options = (type: "prospect" | "client", parties: Party[]) =>
    parties.map((party) => (
      <option key={party.id} value={`${type}:${party.id}`}>
        {party.name}
      </option>
    ));
  const both = prospects.length > 0 && clients.length > 0;

  return (
    <FormDialog
      label={label}
      title="Log meeting"
      icon={<CalendarPlus size={15} />}
      primary={primary}
      action={createMeeting}
    >
      <select className="field" name="party" required defaultValue="">
        <option value="">
          {both ? "With prospect or client" : clients.length ? "Select client" : "Select prospect"}
        </option>
        {both ? (
          <>
            <optgroup label="Prospects">{options("prospect", prospects)}</optgroup>
            <optgroup label="Clients">{options("client", clients)}</optgroup>
          </>
        ) : (
          [...options("prospect", prospects), ...options("client", clients)]
        )}
      </select>
      <input className="field" name="summary" placeholder="Summary" required />
      <label className="label">
        Meeting date
        <input className="field" name="meetingDate" type="date" required />
      </label>
      <label className="label">
        Follow-up
        <input className="field" name="followUpDate" type="date" />
      </label>
      <textarea className="field min-h-20" name="notes" placeholder="Notes" />
      <SubmitButton>Log meeting</SubmitButton>
    </FormDialog>
  );
}
