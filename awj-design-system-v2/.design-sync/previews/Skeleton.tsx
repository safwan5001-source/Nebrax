import { Skeleton } from 'awj-design-system-v2';

export function Default() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 260 }}>
      <Skeleton style={{ height: 16, width: '70%' }} />
      <Skeleton style={{ height: 16, width: '100%' }} />
      <Skeleton style={{ height: 16, width: '85%' }} />
    </div>
  );
}
