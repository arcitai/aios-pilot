import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import {
  createCalendarEvent,
  MAX_CALENDAR_EVENTS,
  MAX_EVENT_DESCRIPTION_LENGTH,
  sortCalendarEvents,
  type CalendarDocument,
} from "../types";
import { createCalendarIcs, downloadTextFile } from "../htmlPreview";

type CalendarEditorProps = {
  document: CalendarDocument;
  onChange: (document: CalendarDocument) => void;
  onDraftDirtyChange: (dirty: boolean) => void;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function eventDateKey(value: string): string {
  return localDateKey(new Date(value));
}

function buildMonthDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(
    first.getFullYear(),
    first.getMonth(),
    first.getDate() - first.getDay(),
  );
  return Array.from(
    { length: 42 },
    (_, index) =>
      new Date(start.getFullYear(), start.getMonth(), start.getDate() + index),
  );
}

function formatMonth(month: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(month);
}

function formatEventTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function safeFilename(): string {
  return `buzz-calendar-${new Date().toISOString().slice(0, 10)}.ics`;
}

export function CalendarEditor({
  document,
  onChange,
  onDraftDirtyChange,
}: CalendarEditorProps) {
  const today = new Date();
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(today));
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("09:30");
  const [formError, setFormError] = useState("");
  const draftDirty =
    title.length > 0 ||
    description.length > 0 ||
    startTime !== "09:00" ||
    endTime !== "09:30";
  const days = useMemo(() => buildMonthDays(visibleMonth), [visibleMonth]);
  const sortedEvents = useMemo(
    () => sortCalendarEvents(document.events),
    [document.events],
  );
  const selectedEvents = sortedEvents.filter(
    (event) => eventDateKey(event.startsAt) === selectedDate,
  );
  const eventDates = new Set(
    document.events.map((event) => eventDateKey(event.startsAt)),
  );
  const selectedDateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${selectedDate}T12:00:00`));

  useEffect(() => {
    onDraftDirtyChange(draftDirty);
    return () => onDraftDirtyChange(false);
  }, [draftDirty, onDraftDirtyChange]);

  function updateEvents(events: CalendarDocument["events"]) {
    onChange({
      ...document,
      updatedAt: new Date().toISOString(),
      events: sortCalendarEvents(events),
    });
  }

  function changeMonth(amount: number) {
    setVisibleMonth(
      (current) =>
        new Date(current.getFullYear(), current.getMonth() + amount, 1),
    );
  }

  function addEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    if (document.events.length >= MAX_CALENDAR_EVENTS) {
      setFormError(
        `This local calendar is limited to ${MAX_CALENDAR_EVENTS} events.`,
      );
      return;
    }
    const result = createCalendarEvent({
      title,
      description,
      startsAt: `${selectedDate}T${startTime}`,
      endsAt: `${selectedDate}T${endTime}`,
    });
    if (!result.ok) {
      setFormError(result.reason);
      return;
    }
    updateEvents([...document.events, result.event]);
    setTitle("");
    setDescription("");
    setStartTime("09:00");
    setEndTime("09:30");
  }

  function removeEvent(id: string) {
    updateEvents(document.events.filter((event) => event.id !== id));
  }

  return (
    <div className="aios-app-editor aios-calendar-editor">
      <div className="aios-editor-toolbar">
        <div className="aios-editor-title-group">
          <p className="aios-eyebrow">Your schedule</p>
          <h2 className="aios-editor-heading">A calm place to plan</h2>
          <p className="aios-muted-copy">
            Events stay in this app workspace and aren’t sent to Google
            Calendar.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={document.events.length === 0}
          onClick={() =>
            downloadTextFile(
              safeFilename(),
              createCalendarIcs(document.events),
              "text/calendar;charset=utf-8",
            )
          }
        >
          <Download aria-hidden="true" />
          Export .ics
        </Button>
      </div>

      <div className="aios-calendar-layout">
        <Card className="aios-calendar-month-card">
          <div className="aios-calendar-month-header">
            <div>
              <p className="aios-eyebrow">Calendar</p>
              <h3>{formatMonth(visibleMonth)}</h3>
            </div>
            <div className="aios-icon-actions">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Previous month"
                onClick={() => changeMonth(-1)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Next month"
                onClick={() => changeMonth(1)}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="aios-calendar-grid">
            {WEEKDAYS.map((day) => (
              <span className="aios-calendar-weekday" key={day}>
                {day}
              </span>
            ))}
            {days.map((day) => {
              const key = localDateKey(day);
              const isSelected = selectedDate === key;
              const isToday = localDateKey(today) === key;
              const isCurrentMonth = day.getMonth() === visibleMonth.getMonth();
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={new Intl.DateTimeFormat(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  }).format(day)}
                  aria-pressed={isSelected}
                  className={[
                    "aios-calendar-day",
                    isSelected ? "is-selected" : "",
                    isToday ? "is-today" : "",
                    isCurrentMonth ? "" : "is-outside-month",
                  ].join(" ")}
                  onClick={() => {
                    setSelectedDate(key);
                    setVisibleMonth(
                      new Date(day.getFullYear(), day.getMonth(), 1),
                    );
                    setFormError("");
                  }}
                >
                  <span>{day.getDate()}</span>
                  {eventDates.has(key) ? (
                    <span
                      className="aios-calendar-event-dot"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="aios-calendar-legend">
            <span className="aios-calendar-event-dot" aria-hidden="true" />
            <span>Has an event</span>
          </div>
        </Card>

        <div className="aios-calendar-side-column">
          <Card className="aios-calendar-agenda-card">
            <div className="aios-calendar-agenda-heading">
              <div>
                <p className="aios-eyebrow">Agenda</p>
                <h3>{selectedDateLabel}</h3>
              </div>
              <span className="aios-event-count">{selectedEvents.length}</span>
            </div>
            {selectedEvents.length ? (
              <ul className="aios-calendar-event-list">
                {selectedEvents.map((event) => (
                  <li className="aios-calendar-event" key={event.id}>
                    <div className="aios-calendar-event-time">
                      <CalendarClock aria-hidden="true" />
                      <span>
                        {formatEventTime(event.startsAt)} –{" "}
                        {formatEventTime(event.endsAt)}
                      </span>
                    </div>
                    <div className="aios-calendar-event-copy">
                      <h4>{event.title}</h4>
                      {event.description ? <p>{event.description}</p> : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${event.title}`}
                      onClick={() => removeEvent(event.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="aios-calendar-empty">
                <CalendarClock aria-hidden="true" />
                <p>Nothing planned yet. Add an event for this day.</p>
              </div>
            )}
          </Card>

          <Card className="aios-calendar-form-card">
            <div className="aios-form-card-heading">
              <div>
                <p className="aios-eyebrow">Add to your day</p>
                <h3>New event</h3>
              </div>
              <Plus aria-hidden="true" />
            </div>
            <form onSubmit={addEvent}>
              <div className="aios-form-field">
                <label htmlFor="aios-event-title">Event name</label>
                <Input
                  id="aios-event-title"
                  required
                  maxLength={200}
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                  placeholder="A conversation, a deadline…"
                />
              </div>
              <div className="aios-time-fields">
                <div className="aios-form-field">
                  <label htmlFor="aios-event-start">Starts</label>
                  <Input
                    id="aios-event-start"
                    type="time"
                    value={startTime}
                    onChange={(event) =>
                      setStartTime(event.currentTarget.value)
                    }
                  />
                </div>
                <div className="aios-form-field">
                  <label htmlFor="aios-event-end">Ends</label>
                  <Input
                    id="aios-event-end"
                    type="time"
                    value={endTime}
                    onChange={(event) => setEndTime(event.currentTarget.value)}
                  />
                </div>
              </div>
              <div className="aios-form-field">
                <label htmlFor="aios-event-notes">
                  Notes <span>(optional)</span>
                </label>
                <Textarea
                  id="aios-event-notes"
                  maxLength={MAX_EVENT_DESCRIPTION_LENGTH}
                  rows={2}
                  value={description}
                  onChange={(event) =>
                    setDescription(event.currentTarget.value)
                  }
                  placeholder="A detail to remember"
                />
              </div>
              {formError ? (
                <p className="aios-inline-error" role="alert">
                  {formError}
                </p>
              ) : null}
              <Button
                type="submit"
                className="aios-calendar-add-button"
                disabled={document.events.length >= MAX_CALENDAR_EVENTS}
              >
                <Plus aria-hidden="true" />
                Add event
              </Button>
            </form>
          </Card>

          <div className="aios-provider-state" role="status">
            <span className="aios-provider-state-dot" aria-hidden="true" />
            <div>
              <strong>Google Calendar · Not connected</strong>
              <p>
                Google Calendar is not connected. These events stay in Buzz.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
