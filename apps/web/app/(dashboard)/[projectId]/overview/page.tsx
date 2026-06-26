import { FennecMascot } from "@fennex/ui";

export default function ProjectOverviewPage({ params }: { params: { projectId: string } }) {
  return (
    <div className="flex flex-col items-center gap-6 py-12">
      <FennecMascot size={80} message="Your project overview loads here" />
      <p className="text-sm text-muted-foreground">Project ID: {params.projectId}</p>
    </div>
  );
}
