import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Page not found</CardTitle>
          <CardDescription>
            The requested route is not available in this build of the dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/login">Return to login</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
