import { useState } from "react";
import { ArrowDown, ArrowUp, Download, Plus, Trash2 } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import {
  createDocumentId,
  MAX_SLIDES,
  type Slide,
  type SlidesDocument,
} from "../types";
import { createSlidesExportHtml, downloadTextFile } from "../htmlPreview";

type SlidesEditorProps = {
  document: SlidesDocument;
  companyName?: string;
  onChange: (document: SlidesDocument) => void;
};

function fileStem(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "slides"
  );
}

export function SlidesEditor({
  document,
  companyName,
  onChange,
}: SlidesEditorProps) {
  const [activeSlideId, setActiveSlideId] = useState(
    document.slides[0]?.id ?? "",
  );
  const [exported, setExported] = useState(false);
  const activeIndex = Math.max(
    0,
    document.slides.findIndex((slide) => slide.id === activeSlideId),
  );
  const activeSlide = document.slides[activeIndex];

  function update(patch: Partial<SlidesDocument>) {
    onChange({ ...document, ...patch, updatedAt: new Date().toISOString() });
  }

  function updateSlide(id: string, patch: Partial<Slide>) {
    update({
      slides: document.slides.map((slide) =>
        slide.id === id ? { ...slide, ...patch } : slide,
      ),
    });
  }

  function addSlide() {
    const slide: Slide = {
      id: createDocumentId("slide"),
      title: "New slide",
      body: "Add one clear point for your audience.",
    };
    update({ slides: [...document.slides, slide] });
    setActiveSlideId(slide.id);
  }

  function removeActiveSlide() {
    if (document.slides.length <= 1) return;
    const nextSlides = document.slides.filter(
      (slide) => slide.id !== activeSlide.id,
    );
    update({ slides: nextSlides });
    setActiveSlideId(nextSlides[Math.max(0, activeIndex - 1)]?.id ?? "");
  }

  function moveActiveSlide(direction: -1 | 1) {
    const nextIndex = activeIndex + direction;
    if (nextIndex < 0 || nextIndex >= document.slides.length) return;
    const nextSlides = [...document.slides];
    [nextSlides[activeIndex], nextSlides[nextIndex]] = [
      nextSlides[nextIndex],
      nextSlides[activeIndex],
    ];
    update({ slides: nextSlides });
  }

  function exportSlides() {
    const html = createSlidesExportHtml(document.title, document.slides);
    downloadTextFile(
      `${fileStem(document.title)}.html`,
      html,
      "text/html;charset=utf-8",
    );
    setExported(true);
    window.setTimeout(() => setExported(false), 2_000);
  }

  if (!activeSlide) return null;

  return (
    <div className="aios-app-editor aios-slides-editor">
      <div className="aios-editor-toolbar">
        <div className="aios-editor-title-group">
          <label className="aios-eyebrow" htmlFor="aios-slides-title">
            Deck title
          </label>
          <Input
            id="aios-slides-title"
            aria-label="Deck title"
            className="aios-deck-title-input"
            maxLength={200}
            value={document.title}
            onChange={(event) => update({ title: event.currentTarget.value })}
          />
          <p className="aios-muted-copy">
            {companyName
              ? `For ${companyName}`
              : "Your story, one slide at a time"}
          </p>
        </div>
        <div className="aios-toolbar-actions">
          <Button
            type="button"
            variant="outline"
            onClick={addSlide}
            disabled={document.slides.length >= MAX_SLIDES}
          >
            <Plus aria-hidden="true" />
            Add slide
          </Button>
          <Button type="button" onClick={exportSlides}>
            <Download aria-hidden="true" />
            {exported ? "Exported" : "Export HTML"}
          </Button>
        </div>
      </div>

      <div className="aios-slides-workbench">
        <Card className="aios-slide-preview-card">
          <section className="aios-slide-stage" aria-label="Slide preview">
            <div className="aios-slide-stage-topline">
              <span>{companyName || "Your business"}</span>
              <span>{String(activeIndex + 1).padStart(2, "0")}</span>
            </div>
            <div className="aios-slide-stage-copy">
              <h2>{activeSlide.title || "Untitled slide"}</h2>
              <p>{activeSlide.body || "Add a short message for this slide."}</p>
            </div>
            <div className="aios-slide-stage-footer">
              <span>{document.title || "Untitled deck"}</span>
              <span>
                {String(activeIndex + 1).padStart(2, "0")} /{" "}
                {String(document.slides.length).padStart(2, "0")}
              </span>
            </div>
          </section>
        </Card>

        <Card className="aios-slide-inspector">
          <div className="aios-inspector-heading">
            <div>
              <p className="aios-eyebrow">Slide {activeIndex + 1}</p>
              <h2>Edit the message</h2>
            </div>
            <div className="aios-icon-actions">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Move slide up"
                disabled={activeIndex === 0}
                onClick={() => moveActiveSlide(-1)}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Move slide down"
                disabled={activeIndex === document.slides.length - 1}
                onClick={() => moveActiveSlide(1)}
              >
                <ArrowDown aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Delete slide"
                disabled={document.slides.length <= 1}
                onClick={removeActiveSlide}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="aios-form-field">
            <label htmlFor="aios-slide-headline">Headline</label>
            <Input
              id="aios-slide-headline"
              maxLength={500}
              value={activeSlide.title}
              onChange={(event) =>
                updateSlide(activeSlide.id, {
                  title: event.currentTarget.value,
                })
              }
            />
          </div>
          <div className="aios-form-field">
            <label htmlFor="aios-slide-body">Supporting text</label>
            <Textarea
              id="aios-slide-body"
              maxLength={8_000}
              rows={7}
              value={activeSlide.body}
              onChange={(event) =>
                updateSlide(activeSlide.id, { body: event.currentTarget.value })
              }
            />
            <span className="aios-character-count">
              {activeSlide.body.length}/8,000
            </span>
          </div>
        </Card>

        <ol className="aios-slide-strip" aria-label="Slides in this deck">
          {document.slides.map((slide, index) => (
            <li key={slide.id}>
              <button
                type="button"
                aria-current={slide.id === activeSlide.id ? "true" : undefined}
                className={`aios-slide-thumbnail${slide.id === activeSlide.id ? " is-active" : ""}`}
                onClick={() => setActiveSlideId(slide.id)}
              >
                <span className="aios-slide-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="aios-slide-thumb-title">
                  {slide.title || "Untitled slide"}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
