import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <Navigate to="/docs/$" params={{ _splat: "" }} />;
}
