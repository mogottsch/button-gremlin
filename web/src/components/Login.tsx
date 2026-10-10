import { useAuth } from '../hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
export function Login() {
  const { login, error, activity } = useAuth();
  const loginFailed = new URLSearchParams(window.location.search).has('authError');
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Button Gremlin</CardTitle>
          <CardDescription>Discord Soundboard</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p>
            {activity
              ? 'Join the launch voice channel, then retry Discord authorization.'
              : 'Sign in with Discord through Authentik. Access requires an explicit Button Gremlin invitation and approval.'}
          </p>
          {(error || loginFailed) && (
            <p role="alert">
              {error || 'Sign-in failed or access was denied. Contact the app owner.'}
            </p>
          )}
          <Button onClick={login} className="w-full">
            {activity ? 'Retry Discord authorization' : 'Sign in with Discord'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
