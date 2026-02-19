import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type DataUnavailableStateProps = {
  title: string;
  description: string;
};

export default function DataUnavailableState({ title, description }: DataUnavailableStateProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
