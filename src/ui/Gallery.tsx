import { type ReactElement, useState } from "react";

import { IconCloud, IconCpu, IconMicrophone, IconServer } from "../lib/icons";
import {
  Badge,
  Button,
  Dialog,
  FormRow,
  FormSection,
  PopUpButton,
  ProgressBar,
  SecureField,
  SegmentedControl,
  SelectMenu,
  SidebarItem,
  Slider,
  Spinner,
  TextField,
  Toggle,
  Tooltip,
} from "./index";

const SEGMENTS = [
  { value: "system", label: "Системная" },
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
] as const;

const SELECT_OPTIONS = [
  { value: "api", label: "API", description: "Свой ключ и эндпоинт" },
  { value: "local", label: "Локально", description: "Встроенные модели", icon: IconServer },
] as const;

/** Dev-only showcase of the native primitives, used for visual verification. */
export function Gallery(): ReactElement {
  const [toggle, setToggle] = useState(true);
  const [segment, setSegment] = useState<(typeof SEGMENTS)[number]["value"]>("system");
  const [popup, setPopup] = useState("light");
  const [menu, setMenu] = useState("api");
  const [text, setText] = useState("Talkee");
  const [secret, setSecret] = useState("secret");
  const [progress, setProgress] = useState(0.4);
  const [slider, setSlider] = useState(60);

  return (
    <div style={{ maxWidth: "var(--workspace-width)", margin: "0 auto" }}>
      <h1 className="section-title-ui" style={{ marginBottom: 20 }}>
        Примитивы интерфейса
      </h1>

      <FormSection title="Кнопки" footer="Обычная, основная и опасная, в двух размерах.">
        <FormRow
          label="Button"
          control={
            <>
              <Button>Обычная</Button>
              <Button variant="primary">Основная</Button>
              <Button variant="destructive">Удалить</Button>
              <Button size="large">Крупная</Button>
              <Button disabled>Выключена</Button>
            </>
          }
        />
      </FormSection>

      <FormSection title="Переключатели и сегменты">
        <FormRow
          label="Toggle"
          control={
            <Toggle checked={toggle} onChange={setToggle} ariaLabel="Обычный переключатель" />
          }
        />
        <FormRow
          label="Toggle (large)"
          control={
            <Toggle
              size="large"
              checked={toggle}
              onChange={setToggle}
              ariaLabel="Крупный переключатель"
            />
          }
        />
        <FormRow
          label="SegmentedControl"
          control={
            <SegmentedControl
              value={segment}
              options={[...SEGMENTS]}
              onChange={(value) => {
                setSegment(value);
                document.documentElement.style.colorScheme =
                  value === "system" ? "light dark" : value;
              }}
              ariaLabel="Тема"
            />
          }
        />
      </FormSection>

      <FormSection title="Диалоги и подсказки">
        <FormRow
          label="Dialog"
          control={
            <Dialog
              trigger={<Button>Открыть пример диалога</Button>}
              title="Пример диалога"
              description="Tab остаётся внутри; Esc закрывает и возвращает фокус."
            >
              <TextField aria-label="Поле диалога" placeholder="Введите текст" />
            </Dialog>
          }
        />
        <FormRow
          label="Tooltip"
          control={
            <Tooltip content="Доступная подсказка">
              <Button>Показать подсказку</Button>
            </Tooltip>
          }
        />
      </FormSection>

      <FormSection title="Списки">
        <FormRow
          label="PopUpButton"
          control={
            <PopUpButton
              value={popup}
              options={[
                { value: "light", label: "Светлая" },
                { value: "dark", label: "Тёмная" },
              ]}
              onChange={setPopup}
              ariaLabel="Тема списка"
            />
          }
        />
        <FormRow
          label="SelectMenu"
          control={
            <SelectMenu
              value={menu}
              options={[...SELECT_OPTIONS]}
              onChange={setMenu}
              ariaLabel="Режим обработки"
              style={{ width: 220 }}
            />
          }
        />
      </FormSection>

      <FormSection title="Поля">
        <FormRow
          label="TextField"
          control={
            <TextField
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label="Имя"
            />
          }
        />
        <FormRow
          label="SecureField"
          control={
            <SecureField
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              aria-label="Ключ"
            />
          }
        />
        <FormRow
          label="Slider"
          control={
            <Slider
              value={slider}
              onChange={setSlider}
              ariaLabel="Громкость"
              style={{ width: 220 }}
            />
          }
        />
      </FormSection>

      <FormSection title="Индикаторы">
        <FormRow label="Badge" control={<Badge>Локально</Badge>} />
        <FormRow label="Spinner" control={<Spinner />} />
        <FormRow
          label="ProgressBar"
          control={
            <div style={{ width: 220 }}>
              <ProgressBar value={progress} ariaLabel="Прогресс" />
            </div>
          }
        />
      </FormSection>

      <FormSection title="Боковая панель">
        <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          <SidebarItem label="История" icon={IconMicrophone} active />
          <SidebarItem label="Модели" icon={IconCpu} onClick={() => setProgress(0.7)} />
          <SidebarItem label="Провайдеры" icon={IconCloud} />
          <SidebarItem label="Локальные" icon={IconServer} />
        </div>
      </FormSection>

      <Button size="large" onClick={() => setProgress(Math.random())}>
        Обновить прогресс
      </Button>
    </div>
  );
}
