import type { ButtonHTMLAttributes, ReactNode } from "react";
import { PixelIcon, type IconName } from "./PixelIcon.tsx";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: "normal" | "primary" | "danger" | "flat";
  block?: boolean;
  icon?: IconName;
  /** 押せない見た目にするが、押したときに理由を出せるよう onClick は呼ぶ */
  softDisabled?: boolean;
  children?: ReactNode;
};

/** 角ばった枠と影のボタン。押すと影が消えて沈む */
export function Button({ variant = "normal", block, icon, softDisabled, className, children, ...rest }: Props) {
  const cls = ["btn", variant !== "normal" && `btn--${variant}`, block && "btn--block", !children && icon && "btn--icon", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type="button" className={cls} aria-disabled={softDisabled || undefined} {...rest}>
      {icon && <PixelIcon name={icon} />}
      {children}
    </button>
  );
}
