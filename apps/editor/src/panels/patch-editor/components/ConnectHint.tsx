/** Why a dropped cable was refused, where it was dropped, with the converter that would make it work. */

import { CircleAlert } from "lucide-react";
import { useEffect } from "react";
import { Button } from "../../../ui/Button.tsx";
import { Popover } from "../../../ui/Popover.tsx";
import { usePatchEditor, useUi } from "../state/context.ts";

export const CONNECT_HINT_MS = 6000;

export function ConnectHint() {
  const { ui } = usePatchEditor();
  const hint = useUi((s) => s.connectHint);
  const close = () => ui.getState().set({ connectHint: null });
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => ui.getState().set({ connectHint: null }), CONNECT_HINT_MS);
    return () => clearTimeout(timer);
  }, [hint, ui]);
  useEffect(() => () => ui.getState().set({ connectHint: null }), [ui]);
  if (!hint) return null;
  return (
    <Popover
      open
      anchor={{ x: hint.client.x, y: hint.client.y, width: 0, height: 0 }}
      onOpenChange={(open) => !open && close()}
      placement="bottom-start"
      offset={10}
      initialFocus="none"
      returnFocus={false}
      role="alert"
      aria-label="Can't connect"
      className="sb-pe-connecthint"
    >
      <CircleAlert className="sb-pe-connecthint__icon" size={14} strokeWidth={1.75} aria-hidden />
      <div className="sb-pe-connecthint__body">
        <div className="sb-pe-connecthint__reason">{hint.reason}</div>
        {hint.hint && <div className="sb-pe-connecthint__hint">{hint.hint}</div>}
        {hint.converter && (
          <Button
            variant="secondary"
            onClick={() => {
              hint.converter!.insert();
              close();
            }}
          >
            {hint.converter.label}
          </Button>
        )}
      </div>
    </Popover>
  );
}
