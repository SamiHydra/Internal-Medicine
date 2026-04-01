import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function AppStateScreen({
  title,
  description,
  detail,
}: {
  title: string
  description: string
  detail?: string | null
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(20,184,166,0.1),_transparent_35%),linear-gradient(180deg,_#f8fbff_0%,_#eef4fb_100%)] px-4 py-8">
      <Card className="w-full max-w-xl border-white/80 bg-white/92">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        {detail ? (
          <CardContent className="text-sm leading-7 text-slate-600">
            {detail}
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}
