"use client";

import { AlertCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";

export function ErrorAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden="true" />
      <span>{message}</span>
    </Alert>
  );
}
