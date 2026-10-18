import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Users } from 'lucide-react';
import { GENDER_LABELS, LANGUAGES } from '@orbit/shared';
import { usePublicProfile } from '@/hooks/queries';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, ErrorState, Skeleton } from '@/components/ui/Feedback';
import { Card, CardBody } from '@/components/ui/Card';

export default function PublicProfilePage() {
  const { userId = '' } = useParams();
  const q = usePublicProfile(userId);
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <Link to="/app/friends" className="inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Friends
      </Link>
      <div className="mt-4">
        {q.isLoading ? (
          <Skeleton className="h-48" />
        ) : q.isError || !q.data ? (
          <ErrorState title="Profile not available" message="Profiles are visible only to friends." />
        ) : (
          <Card>
            <CardBody className="text-center">
              <Avatar seed={q.data.avatarSeed} style={q.data.avatarStyle} size={96} className="mx-auto" label={`${q.data.displayName}'s avatar`} />
              <h1 className="mt-3 text-2xl font-extrabold">{q.data.displayName}</h1>
              <p className="text-sm text-muted">@{q.data.publicId}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-1.5">
                <Badge>{LANGUAGES.find((l) => l.code === q.data.language)?.label ?? q.data.language}</Badge>
                {q.data.gender && q.data.gender !== 'prefer_not_to_say' && <Badge>{GENDER_LABELS[q.data.gender]}</Badge>}
                {q.data.isFriend && <Badge tone="success">Friend</Badge>}
              </div>
              {q.data.bio && <p className="mx-auto mt-4 max-w-md whitespace-pre-wrap break-anywhere text-sm">{q.data.bio}</p>}
              {q.data.interests.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">{q.data.interests.map((i) => <Badge key={i} tone="primary">{i}</Badge>)}</div>
              )}
              <div className="mt-4 flex justify-center gap-4 text-sm text-muted">
                {q.data.friendsCount !== null && <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" aria-hidden /> {q.data.friendsCount} friends</span>}
                <span className="inline-flex items-center gap-1"><CalendarDays className="h-4 w-4" aria-hidden /> Since {new Date(q.data.createdAt).toLocaleDateString()}</span>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
