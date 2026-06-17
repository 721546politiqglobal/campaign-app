import { AppFrame } from '@/components/AppFrame';
import { ContentEditor } from '@/components/ContentEditor';

export default function NewContent() {
  return (
    <AppFrame>
      <div className="pagehead">
        <div><span className="eyebrow">Create</span><h1>New content</h1></div>
      </div>
      <ContentEditor />
    </AppFrame>
  );
}
