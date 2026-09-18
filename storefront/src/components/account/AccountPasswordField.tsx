"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function AccountPasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  showLabel,
  hideLabel,
  required = true,
  minLength,
  describedBy,
  invalid,
  className,
  controlClassName,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  showLabel: string;
  hideLabel: string;
  required?: boolean;
  minLength?: number;
  describedBy?: string;
  invalid?: boolean;
  className?: string;
  controlClassName?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className={cn("relative", controlClassName)}>
        <Input
          type={visible ? "text" : "password"}
          id={id}
          name={id}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
          minLength={minLength}
          placeholder="••••••••"
          className="pe-10"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        />
        <div className="absolute inset-y-0 end-1 flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? hideLabel : showLabel}
          >
            {visible ? (
              <EyeOff className="size-5" />
            ) : (
              <Eye className="size-5" />
            )}
          </Button>
        </div>
      </div>
    </Field>
  );
}
