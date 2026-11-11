import { noteAction } from "@/app/actions";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { currentUser } from "@/lib/auth/current";
import { listNotes } from "@/lib/services/engine";

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const { user, runtime } = await currentUser();
  const notes = listNotes(runtime.db, user.id);
  return (
    <div>
      <Notice notice={notice} />
      <h1 className="serif text-4xl">Meeting notes</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Paste a transcript or a line from the hallway. Ledger echoes what it understood so you can correct it. A note-taker can
        also POST to <span className="font-mono text-xs">/api/notes/webhook</span>.
      </p>
      <form action={noteAction} className="mt-5 space-y-3">
        <Input name="title" placeholder="Atlanta CFO summit" />
        <Textarea
          name="body"
          placeholder="Met Dana Lee at the Atlanta CFO summit. She wants a proposal on finance transformation. Follow up after Thanksgiving."
          required
        />
        <Button type="submit">File the note</Button>
      </form>
      <ul className="mt-8 space-y-4">
        {notes.map((note) => (
          <li key={note.id} className="rounded-lg border border-border bg-card p-4">
            <p className="font-medium">{note.title}</p>
            <p className="mt-2 text-sm text-muted-foreground">{note.echo}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
