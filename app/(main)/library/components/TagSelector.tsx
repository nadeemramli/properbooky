import { Fragment, useEffect, useState } from "react";
import { Combobox, Dialog, Transition } from "@headlessui/react";
import { Plus, Tag } from "lucide-react";
import type { Tag as TagType } from "@/types/book";
import { addTagToBook, createTag, getTags, removeTagFromBook } from "@/lib/api";
import { TagBadge } from "./TagBadge";
import { toast } from "sonner";

interface TagSelectorProps {
  bookId: string;
  currentTags: TagType[];
  onTagsChange: (tags: TagType[]) => void;
}

export function TagSelector({
  bookId,
  currentTags,
  onTagsChange,
}: TagSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [allTags, setAllTags] = useState<TagType[]>([]);
  const [selectedTag, setSelectedTag] = useState<TagType | null>(null);

  useEffect(() => {
    loadTags();
  }, []);

  async function loadTags() {
    try {
      const tags = await getTags();
      setAllTags(tags);
    } catch (error) {
      toast.error("Failed to load tags");
    }
  }

  const filteredTags =
    query === ""
      ? allTags
      : allTags.filter((tag) => {
          return tag.name.toLowerCase().includes(query.toLowerCase());
        });

  async function handleTagSelect(tag: TagType) {
    try {
      await addTagToBook(bookId, tag.id);
      onTagsChange([...currentTags, tag]);
      setSelectedTag(null);
      setQuery("");
    } catch (error) {
      toast.error("Failed to add tag");
    }
  }

  async function handleCreateTag(name: string) {
    try {
      const newTag = await createTag(name);
      setAllTags([...allTags, newTag]);
      await handleTagSelect(newTag);
    } catch (error) {
      toast.error("Failed to create tag");
    }
  }

  async function handleRemoveTag(tagId: string) {
    try {
      await removeTagFromBook(bookId, tagId);
      onTagsChange(currentTags.filter((tag) => tag.id !== tagId));
    } catch (error) {
      toast.error("Failed to remove tag");
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {currentTags.map((tag) => (
          <TagBadge
            key={tag.id}
            tag={tag}
            onRemove={() => handleRemoveTag(tag.id)}
          />
        ))}
        <button
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center gap-1 rounded-full border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <Plus className="h-3 w-3" />
          Add tag
        </button>
      </div>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-50"
          onClose={() => setIsOpen(false)}
        >
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black bg-opacity-25" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title
                    as="h3"
                    className="text-lg font-medium leading-6 text-gray-900"
                  >
                    Add tags
                  </Dialog.Title>
                  <div className="mt-4">
                    <Combobox value={selectedTag} onChange={handleTagSelect}>
                      <div className="relative">
                        <div className="relative w-full cursor-default overflow-hidden rounded-lg bg-white text-left focus:outline-none sm:text-sm">
                          <Combobox.Input
                            className="w-full border-none py-2 pl-3 pr-10 text-sm leading-5 text-gray-900 focus:ring-0"
                            displayValue={(tag: TagType) => tag?.name}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search or create tag..."
                          />
                          <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-2">
                            <Tag
                              className="h-5 w-5 text-gray-400"
                              aria-hidden="true"
                            />
                          </Combobox.Button>
                        </div>
                        <Transition
                          as={Fragment}
                          leave="transition ease-in duration-100"
                          leaveFrom="opacity-100"
                          leaveTo="opacity-0"
                          afterLeave={() => setQuery("")}
                        >
                          <Combobox.Options className="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                            {filteredTags.length === 0 && query !== "" ? (
                              <div
                                className="relative cursor-pointer select-none py-2 px-4 text-gray-700 hover:bg-gray-100"
                                onClick={() => handleCreateTag(query)}
                              >
                                Create "{query}"
                              </div>
                            ) : (
                              filteredTags.map((tag) => (
                                <Combobox.Option
                                  key={tag.id}
                                  className={({ active }) =>
                                    `relative cursor-pointer select-none py-2 pl-10 pr-4 ${
                                      active
                                        ? "bg-gray-100 text-gray-900"
                                        : "text-gray-900"
                                    }`
                                  }
                                  value={tag}
                                >
                                  {({ selected, active }) => (
                                    <>
                                      <span
                                        className={`block truncate ${
                                          selected
                                            ? "font-medium"
                                            : "font-normal"
                                        }`}
                                      >
                                        {tag.name}
                                      </span>
                                    </>
                                  )}
                                </Combobox.Option>
                              ))
                            )}
                          </Combobox.Options>
                        </Transition>
                      </div>
                    </Combobox>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
